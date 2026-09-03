'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 3847);
const BASE_PATH = normalizeBasePath(process.env.BASE_PATH || '');
const TAG_NAME = String(process.env.DESCADASTRAR_TAG_NAME || 'descadastrar').trim();
const AUTH_USER = String(process.env.DESCADASTRAR_USER || 'admin').trim();
const AUTH_PASS = String(process.env.DESCADASTRAR_PASS || 'admin');
const AUTH_SECRET = String(
  process.env.DESCADASTRAR_AUTH_SECRET ||
  `descadastrar:${AUTH_USER}:${AUTH_PASS}`
);

const AC_BASE = String(
  process.env.ACTIVECAMPAIGN_API_URL ||
  process.env.ACTIVE_API_BASE ||
  ''
).replace(/\/+$/, '');

const AC_TOKEN = String(
  process.env.ACTIVECAMPAIGN_API_KEY ||
  process.env.ACTIVE_API_TOKEN ||
  process.env.ACTIVECAMPAIGN_API_TOKEN ||
  ''
).trim();

let cachedTagId = null;

function normalizeBasePath(raw) {
  let p = String(raw || '').trim();
  if (!p || p === '/') return '';
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/+$/, '');
}

function logLine(parts) {
  const ts = new Date().toISOString();
  console.log([ts, ...parts].join(' | '));
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Máscara BR: (XX) XXXX-XXXX ou (XX) XXXXX-XXXX */
function formatBrPhone(nationalDigits) {
  const n = onlyDigits(nationalDigits);
  if (n.length === 11) {
    return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  }
  if (n.length === 10) {
    return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  }
  return null;
}

/**
 * Variantes essenciais (menos requests):
 * DDD9NUMERO, DDDNUMERO, 55…, formatado (XX) …
 */
function phoneVariants(raw) {
  const d = onlyDigits(raw);
  if (!d) return [];

  let national = d;
  if (national.startsWith('55') && national.length >= 12) {
    national = national.slice(2);
  }
  if (national.length > 11) national = national.slice(-11);

  const nationals = new Set();
  if (national.length === 11) {
    nationals.add(national);
    if (national[2] === '9') {
      nationals.add(national.slice(0, 2) + national.slice(3));
    }
  } else if (national.length === 10) {
    nationals.add(national);
    nationals.add(national.slice(0, 2) + '9' + national.slice(2));
  } else if (national.length >= 8) {
    nationals.add(national);
  }

  const set = new Set();
  for (const n of nationals) {
    set.add(n);
    set.add(`55${n}`);
    const fmt = formatBrPhone(n);
    if (fmt) set.add(fmt);
  }
  return [...set];
}

/** WHATWG HTML email + exige domínio com TLD (ex.: @gmail.com, @empresa.com.br) */
function isValidEmail(email) {
  const v = String(email || '').trim();
  if (!v || v.length > 254) return false;
  // Spec WHATWG (input type=email) — willful violation of RFC 5322
  // https://html.spec.whatwg.org/multipage/input.html#email-state-(type=email)
  const whatwg =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!whatwg.test(v)) return false;
  const domain = v.slice(v.lastIndexOf('@') + 1);
  // Exige pelo menos um ponto no domínio (user@host → inválido aqui)
  if (!domain.includes('.')) return false;
  const tld = domain.split('.').pop() || '';
  return /^[a-zA-Z]{2,63}$/.test(tld);
}

function mapContact(c) {
  if (!c || !c.id) return null;
  return {
    id: String(c.id),
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    email: c.email || '',
    phone: c.phone || '',
    cdate: c.cdate || null,
  };
}

const tagNameCache = new Map();

async function getTagName(tagId) {
  const id = String(tagId);
  if (tagNameCache.has(id)) return tagNameCache.get(id);
  const data = await acFetch(`/api/3/tags/${id}`);
  const name = String(data.tag?.tag || '');
  tagNameCache.set(id, name);
  return name;
}

async function warmTagNames(tagIds) {
  const missing = [...new Set(tagIds.map(String))].filter((id) => id && !tagNameCache.has(id));
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    try {
      const data = await acFetch('/api/3/tags', { query: { ids: chunk.join(',') } });
      for (const t of data.tags || []) {
        tagNameCache.set(String(t.id), String(t.tag || ''));
      }
    } catch (_) {
      // fallback individual
      await Promise.all(chunk.map((id) => getTagName(id).catch(() => '')));
    }
    for (const id of chunk) {
      if (!tagNameCache.has(id)) tagNameCache.set(id, '');
    }
  }
}

/** Extrai labels de aluno; EI/SC com turma quando a tag tiver número. */
function alunoLabelsFromTagNames(tagNames) {
  const turmas = new Map(); // EI30 -> "EI turma 30"
  const outros = [];

  for (const raw of tagNames) {
    const name = String(raw || '');
    const turma = /^aluno-(EI|SC)(\d{2})(?:-.*)?$/i.exec(name);
    if (turma) {
      const produto = turma[1].toUpperCase();
      const num = turma[2];
      turmas.set(`${produto}${num}`, `${produto} turma ${num}`);
      continue;
    }
    const m = /^aluno-(.+)$/i.exec(name);
    if (!m) continue;
    const rest = String(m[1]).toUpperCase();
    // evita redundância tipo "EI" genérico se já tem turma EI
    if (/^(EI|SC)$/.test(rest)) {
      const hasTurma = [...turmas.keys()].some((k) => k.startsWith(rest));
      if (!hasTurma) outros.push(rest);
      continue;
    }
    if (/^(EI|SC)\d{2}/.test(rest)) continue; // já coberto pelo regex de turma
    outros.push(rest);
  }

  return [...turmas.values(), ...new Set(outros)];
}

/** Lê tags do contato: aluno-* (com turma EI/SC) e DESCADASTRAR. */
async function enrichContactsWithTags(contacts) {
  if (!contacts.length) return contacts;

  const tagIdsByContact = new Map();
  await Promise.all(
    contacts.map(async (c) => {
      try {
        const data = await acFetch(`/api/3/contacts/${c.id}/contactTags`);
        const ids = (data.contactTags || [])
          .map((row) => String(row.tag || ''))
          .filter(Boolean);
        tagIdsByContact.set(c.id, ids);
      } catch (_) {
        tagIdsByContact.set(c.id, []);
      }
    })
  );

  const allIds = [...tagIdsByContact.values()].flat();
  await warmTagNames(allIds);

  return contacts.map((c) => {
    const names = (tagIdsByContact.get(c.id) || [])
      .map((id) => tagNameCache.get(id) || '')
      .filter(Boolean);
    return {
      ...c,
      alreadyDescadastrado: names.includes('DESCADASTRAR'),
      alunoDe: alunoLabelsFromTagNames(names),
    };
  });
}

async function acFetch(urlPath, { method = 'GET', query, body } = {}, attempt = 1) {
  if (!AC_BASE || !AC_TOKEN) {
    const err = new Error('ActiveCampaign não configurado (URL/API key)');
    err.status = 500;
    throw err;
  }
  const q = query ? `?${new URLSearchParams(query)}` : '';
  const url = `${AC_BASE}${urlPath}${q}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Api-Token': AC_TOKEN,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return acFetch(urlPath, { method, query, body }, attempt + 1);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text.slice(0, 300) };
  }

  if (!res.ok) {
    const err = new Error(
      (data && (data.message || data.error)) ||
      `ActiveCampaign ${res.status}`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function searchByEmail(email) {
  const data = await acFetch('/api/3/contacts', { query: { email: String(email).trim() } });
  return (data.contacts || []).map(mapContact).filter(Boolean);
}

function phonesMatch(contactPhone, queryVariant) {
  const a = onlyDigits(contactPhone);
  const b = onlyDigits(queryVariant);
  if (!a || !b) return false;
  return (
    a === b ||
    a.endsWith(b) ||
    b.endsWith(a) ||
    a.includes(b) ||
    b.includes(a)
  );
}

async function searchByPhoneVariant(variant) {
  const out = new Map();
  try {
    const byPhone = await acFetch('/api/3/contacts', { query: { phone: variant, limit: '50' } });
    for (const c of (byPhone.contacts || []).map(mapContact).filter(Boolean)) {
      out.set(c.id, c);
    }
  } catch (_) { /* ignore e tenta search */ }

  const bySearch = await acFetch('/api/3/contacts', { query: { search: variant, limit: '50' } });
  for (const c of (bySearch.contacts || []).map(mapContact).filter(Boolean)) {
    if (!c.phone) continue;
    if (phonesMatch(c.phone, variant)) out.set(c.id, c);
  }
  return [...out.values()];
}

async function resolveTagId() {
  if (cachedTagId) return cachedTagId;
  const data = await acFetch('/api/3/tags', {
    query: { search: TAG_NAME, limit: '100' },
  });
  const tags = data.tags || [];
  const target = TAG_NAME.toLowerCase();
  const exact = tags.find((t) => String(t.tag || '').toLowerCase() === target);
  if (!exact || !exact.id) {
    const err = new Error(`Tag "${TAG_NAME}" não encontrada no ActiveCampaign`);
    err.status = 404;
    throw err;
  }
  cachedTagId = String(exact.id);
  return cachedTagId;
}

async function applyTag(contactId) {
  const tagId = await resolveTagId();
  try {
    await acFetch('/api/3/contactTags', {
      method: 'POST',
      body: {
        contactTag: {
          contact: String(contactId),
          tag: tagId,
        },
      },
    });
    return { ok: true, already: false, tagId };
  } catch (err) {
    const msg = String(err.message || '');
    const body = JSON.stringify(err.data || {});
    // idempotente: já tem a tag
    if (
      err.status === 422 ||
      /already|duplicate|exists|já|exist/i.test(`${msg} ${body}`)
    ) {
      return { ok: true, already: true, tagId };
    }
    throw err;
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    u: user,
    t: Date.now(),
  })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || data.u !== AUTH_USER) return null;
    // 30 dias
    if (Date.now() - Number(data.t || 0) > 30 * 24 * 60 * 60 * 1000) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function extractToken(req) {
  const hdr = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  if (m) return m[1].trim();
  return String(req.headers['x-descadastrar-token'] || '').trim();
}

function requireAuth(req, res, next) {
  const session = verifyToken(extractToken(req));
  if (!session) {
    return res.status(401).json({ error: 'Não autenticado. Faça login.' });
  }
  req.session = session;
  return next();
}

const router = express.Router();

router.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  fallthrough: true,
}));

router.get(['/', '/index.html'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

router.post('/api/login', (req, res) => {
  const user = String(req.body?.user || req.body?.username || '').trim();
  const pass = String(req.body?.pass || req.body?.password || '');
  if (user !== AUTH_USER || pass !== AUTH_PASS) {
    logLine(['auth=login', 'erro=credenciais inválidas']);
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  const token = makeToken(user);
  logLine(['auth=login', `user=${user}`, 'ok=1']);
  return res.json({ ok: true, token, user });
});

router.get('/api/me', requireAuth, (req, res) => {
  return res.json({ ok: true, user: req.session.u });
});

router.post('/api/buscar', requireAuth, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  const telefone = String(req.body?.telefone || '').trim();
  const phoneDigits = onlyDigits(telefone);
  const busca = {
    email: email || undefined,
    telefone: phoneDigits || undefined,
  };

  if (!email && !telefone) {
    logLine([`busca=${JSON.stringify(busca)}`, 'contactId=-', 'erro=informe email ou telefone']);
    return res.status(400).json({ error: 'Informe telefone e/ou e-mail.' });
  }

  if (email && !isValidEmail(email)) {
    logLine([`busca=${JSON.stringify(busca)}`, 'contactId=-', 'erro=email inválido']);
    return res.status(400).json({
      error: 'E-mail inválido. Use o formato nome@dominio.com (ou .com.br, etc.).',
    });
  }

  if (telefone && phoneDigits.length < 10) {
    logLine([`busca=${JSON.stringify(busca)}`, 'contactId=-', 'erro=telefone incompleto']);
    return res.status(400).json({
      error: 'Telefone incompleto. Informe DDD + número (10 ou 11 dígitos).',
    });
  }

  try {
    const byId = new Map();

    function upsert(contact, via) {
      const prev = byId.get(contact.id);
      if (!prev) {
        byId.set(contact.id, {
          ...contact,
          matchedVia: {
            email: !!via.email,
            phone: !!via.phone,
          },
        });
        return;
      }
      byId.set(contact.id, {
        ...prev,
        ...contact,
        matchedVia: {
          email: prev.matchedVia.email || !!via.email,
          phone: prev.matchedVia.phone || !!via.phone,
        },
      });
    }

    if (email) {
      for (const c of await searchByEmail(email)) upsert(c, { email: true });
    }

    if (telefone) {
      const variants = phoneVariants(telefone);
      const settled = await Promise.all(
        variants.map((variant) => searchByPhoneVariant(variant))
      );
      for (const list of settled) {
        for (const c of list) upsert(c, { phone: true });
      }
      logLine([
        `busca=${JSON.stringify(busca)}`,
        `variants=${variants.length}`,
        `contactId=${[...byId.keys()].join(',') || '-'}`,
        `ok=phone_merge`,
      ]);
    }

    const emailNorm = email ? email.toLowerCase() : '';
    for (const c of byId.values()) {
      if (emailNorm && c.email && c.email.trim().toLowerCase() === emailNorm) {
        c.matchedVia.email = true;
      }
      if (phoneDigits && c.phone && phonesMatch(c.phone, phoneDigits)) {
        c.matchedVia.phone = true;
      }
    }

    const contacts = await enrichContactsWithTags([...byId.values()]);
    logLine([
      `busca=${JSON.stringify(busca)}`,
      `contactId=${contacts.map((c) => c.id).join(',') || '-'}`,
      `ok=found:${contacts.length}`,
    ]);
    return res.json({ contacts });
  } catch (err) {
    logLine([`busca=${JSON.stringify(busca)}`, 'contactId=-', `erro=${err.message}`]);
    return res.status(err.status && err.status < 500 ? err.status : 502).json({
      error: err.message || 'Falha ao buscar no ActiveCampaign',
    });
  }
});

router.post('/api/descadastrar', requireAuth, async (req, res) => {
  const contactId = String(req.body?.contactId || '').trim();
  if (!contactId) {
    logLine(['busca=-', 'contactId=-', 'erro=contactId obrigatório']);
    return res.status(400).json({ error: 'contactId obrigatório.' });
  }

  try {
    const result = await applyTag(contactId);
    logLine([
      'busca=-',
      `contactId=${contactId}`,
      `ok=tag:${TAG_NAME}${result.already ? '(já tinha)' : ''}`,
    ]);
    return res.json({
      ok: true,
      already: result.already,
      tag: TAG_NAME,
      tagId: result.tagId,
      message: result.already
        ? 'Contato já estava com a tag descadastrar.'
        : 'Tag descadastrar aplicada com sucesso.',
    });
  } catch (err) {
    logLine(['busca=-', `contactId=${contactId}`, `erro=${err.message}`]);
    return res.status(err.status && err.status < 500 ? err.status : 502).json({
      error: err.message || 'Falha ao aplicar tag',
    });
  }
});

if (BASE_PATH) {
  app.use(BASE_PATH, router);
  app.get('/', (_req, res) => res.redirect(BASE_PATH + '/'));
} else {
  app.use(router);
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
});

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}${BASE_PATH}/`;
  console.log(`Descadastrar em ${url}`);
  if (!AC_BASE || !AC_TOKEN) {
    console.warn('AVISO: configure ACTIVECAMPAIGN_API_URL e ACTIVECAMPAIGN_API_KEY no .env');
  }
});
