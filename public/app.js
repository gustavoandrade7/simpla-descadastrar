(() => {
  const AUTH_KEY = 'descadastrar.auth';
  const loginScreen = document.getElementById('login-screen');
  const appShell = document.getElementById('app-shell');
  const loginForm = document.getElementById('login-form');
  const loginUser = document.getElementById('login-user');
  const loginPass = document.getElementById('login-pass');
  const loginRemember = document.getElementById('login-remember');
  const loginError = document.getElementById('login-error');
  const btnLogin = document.getElementById('btn-login');

  const form = document.getElementById('search-form');
  const phoneEl = document.getElementById('input-phone');
  const emailEl = document.getElementById('input-email');
  const emailWrap = document.getElementById('email-wrap');
  const emailCheck = document.getElementById('email-check');
  const btnSearch = document.getElementById('btn-search');
  const feedback = document.getElementById('feedback');
  const results = document.getElementById('results');
  const waHelp = document.getElementById('wa-help');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalMessage = document.getElementById('modal-message');
  const modalConfirmBtn = document.getElementById('modal-confirm');
  const modalCancelBtn = document.getElementById('modal-cancel');

  const WA_HELP_NUMBER = '5532999741021';
  let modalResolver = null;

  function apiUrl(path) {
    const base = document.querySelector('base')?.getAttribute('href');
    if (base) return new URL(path.replace(/^\//, ''), base).pathname;
    const root = window.location.pathname.replace(/\/?index\.html$/, '').replace(/\/?$/, '/');
    return `${root}${path.replace(/^\//, '')}`;
  }

  function authStore(remember) {
    return remember ? localStorage : sessionStorage;
  }

  function readAuth() {
    try {
      const raw = localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.token) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function writeAuth(data, remember) {
    clearAuth();
    authStore(remember).setItem(AUTH_KEY, JSON.stringify(data));
  }

  function clearAuth() {
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(AUTH_KEY);
  }

  function getToken() {
    return readAuth()?.token || '';
  }

  function showLogin(msg) {
    appShell.hidden = true;
    loginScreen.hidden = false;
    if (msg) {
      loginError.hidden = false;
      loginError.textContent = msg;
    } else {
      loginError.hidden = true;
      loginError.textContent = '';
    }
  }

  function showApp() {
    loginScreen.hidden = true;
    appShell.hidden = false;
    loginError.hidden = true;
  }

  function clearFeedback() {
    feedback.hidden = true;
    feedback.innerHTML = '';
  }

  function clearResults() {
    results.hidden = true;
    results.innerHTML = '';
  }

  async function ensureSession() {
    const auth = readAuth();
    if (!auth?.token) {
      showLogin();
      return false;
    }
    try {
      const res = await fetch(apiUrl('api/me'), {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
      });
      if (!res.ok) {
        clearAuth();
        showLogin('Sessão expirada. Entre novamente.');
        return false;
      }
      showApp();
      return true;
    } catch (_) {
      showLogin('Falha ao validar sessão.');
      return false;
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    btnLogin.disabled = true;
    btnLogin.querySelector('span').textContent = 'ENTRANDO...';
    try {
      const res = await fetch(apiUrl('api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          user: loginUser.value.trim(),
          pass: loginPass.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha no login');
      writeAuth({ token: data.token, user: data.user }, !!loginRemember.checked);
      loginPass.value = '';
      showApp();
    } catch (err) {
      showLogin(err.message || 'Usuário ou senha inválidos.');
    } finally {
      btnLogin.disabled = false;
      btnLogin.querySelector('span').textContent = 'ENTRAR';
    }
  });

  function closeModal(result) {
    modalOverlay.hidden = true;
    document.body.style.overflow = '';
    const resolve = modalResolver;
    modalResolver = null;
    if (resolve) resolve(!!result);
  }

  function askConfirm({ title = 'Confirmação', message = '', confirmLabel = 'CONFIRMAR', cancelLabel = 'CANCELAR' } = {}) {
    return new Promise((resolve) => {
      if (modalResolver) closeModal(false);
      modalResolver = resolve;
      modalTitle.textContent = title;
      modalMessage.textContent = message;
      modalConfirmBtn.textContent = confirmLabel;
      modalCancelBtn.textContent = cancelLabel;
      modalOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      modalConfirmBtn.focus();
    });
  }

  modalConfirmBtn.addEventListener('click', () => closeModal(true));
  modalCancelBtn.addEventListener('click', () => closeModal(false));
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal(false);
  });
  document.addEventListener('keydown', (e) => {
    if (modalOverlay.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(false);
    }
  });

  // WHATWG HTML Living Standard — email state
  // https://html.spec.whatwg.org/multipage/input.html#email-state-(type=email)
  const WHATWG_EMAIL =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  function buildWaHelpHref() {
    const phone = phoneEl.value.trim();
    const email = emailEl.value.trim();
    const lines = ['Gustavo, não consegui descadastrar o lead, me ajuda!'];
    if (phone || email) lines.push('');
    if (phone) lines.push(`Número: ${phone}`);
    if (email) lines.push(`E-mail: ${email}`);
    return `https://wa.me/${WA_HELP_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  function refreshWaHelpLink() {
    if (waHelp) waHelp.href = buildWaHelpHref();
  }

  function isValidEmail(email) {
    const v = String(email || '').trim();
    if (!v || v.length > 254) return false;
    if (!WHATWG_EMAIL.test(v)) return false;
    const domain = v.slice(v.lastIndexOf('@') + 1);
    if (!domain.includes('.')) return false;
    const tld = domain.split('.').pop() || '';
    return /^[a-zA-Z]{2,63}$/.test(tld);
  }

  function maskBrPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.startsWith('55') && d.length > 11) d = d.slice(2);
    d = d.slice(0, 11);
    if (!d) return '';
    if (d.length < 3) return `(${d}`;
    const ddd = d.slice(0, 2);
    const rest = d.slice(2);
    if (rest.length <= 4) return `(${ddd}) ${rest}`;
    if (d.length <= 10) {
      return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
    return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function fullName(c) {
    const n = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    return n || '(sem nome)';
  }

  function showFeedback(type, html) {
    feedback.hidden = false;
    feedback.innerHTML = `<p class="${type === 'success' ? 'issuccess' : 'iserror'}">${html}</p>`;
  }

  function updateEmailCheck() {
    const v = emailEl.value.trim();
    emailWrap.classList.remove('is-valid', 'is-invalid');
    if (!v) {
      emailCheck.hidden = true;
      emailCheck.textContent = '';
      return;
    }
    if (isValidEmail(v)) {
      emailWrap.classList.add('is-valid');
      emailCheck.hidden = false;
      emailCheck.textContent = '✓';
      emailCheck.title = 'E-mail válido';
    } else {
      emailWrap.classList.add('is-invalid');
      emailCheck.hidden = false;
      emailCheck.textContent = '!';
      emailCheck.title = 'E-mail inválido — use nome@dominio.com';
    }
  }

  phoneEl.addEventListener('input', () => {
    const masked = maskBrPhone(phoneEl.value);
    phoneEl.value = masked;
    refreshWaHelpLink();
  });

  phoneEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    phoneEl.value = maskBrPhone(text);
    refreshWaHelpLink();
  });

  emailEl.addEventListener('input', () => {
    updateEmailCheck();
    refreshWaHelpLink();
  });
  emailEl.addEventListener('blur', updateEmailCheck);

  refreshWaHelpLink();

  async function postJson(path, body) {
    const token = getToken();
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      clearAuth();
      showLogin('Sessão expirada. Entre novamente.');
      throw new Error('Não autenticado');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }
    return data;
  }

  function renderContacts(contacts) {
    results.hidden = false;
    results.innerHTML = contacts.map((c) => {
      const name = escapeHtml(fullName(c));
      const email = escapeHtml(c.email || '—');
      const phone = escapeHtml(c.phone || '—');
      const created = escapeHtml(formatDate(c.cdate));
      const id = escapeHtml(c.id);
      const via = c.matchedVia || {};
      const emailMark = via.email
        ? ' <span class="match-mark">→ ENCONTRADO</span>'
        : '';
      const phoneMark = via.phone
        ? ' <span class="match-mark">→ ENCONTRADO</span>'
        : '';
      const alunoList = Array.isArray(c.alunoDe) ? c.alunoDe : [];
      const alunoHtml = alunoList.length
        ? `<p class="contact-meta"><span>Aluno:</span> ${escapeHtml(alunoList.join(', '))}</p>`
        : '';
      const alreadyHtml = c.alreadyDescadastrado
        ? `<p class="contact-badge">Contato já descadastrado</p>`
        : '';
      return `
        <article class="contact-card" data-id="${id}">
          <h2>${name}</h2>
          ${alreadyHtml}
          <p class="contact-meta"><span>E-mail:</span> ${email}${emailMark}</p>
          <p class="contact-meta"><span>Telefone:</span> ${phone}${phoneMark}</p>
          <p class="contact-meta"><span>Criado em:</span> ${created}</p>
          ${alunoHtml}
          <div class="contact-actions">
            <button type="button" class="button" data-action="confirm">CONFIRMAR DESCADASTRAR</button>
            <button type="button" class="button secondary" data-action="cancel">NÃO FAZER NADA</button>
          </div>
        </article>
      `;
    }).join('');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFeedback();
    clearResults();

    const telefone = phoneEl.value.trim();
    const email = emailEl.value.trim();
    const phoneDigits = telefone.replace(/\D/g, '');

    if (!telefone && !email) {
      showFeedback('error', 'Informe <strong>telefone</strong> e/ou <strong>e-mail</strong> para buscar.');
      return;
    }

    if (email && !isValidEmail(email)) {
      updateEmailCheck();
      showFeedback(
        'error',
        'E-mail inválido. Use o formato <strong>nome@dominio.com</strong> (aceita .com.br, etc.).'
      );
      return;
    }

    if (telefone && phoneDigits.length < 10) {
      showFeedback(
        'error',
        'Telefone incompleto. Informe <strong>DDD + número</strong> (10 ou 11 dígitos).'
      );
      return;
    }

    btnSearch.disabled = true;
    btnSearch.querySelector('span').textContent = 'BUSCANDO...';
    try {
      const data = await postJson('api/buscar', { telefone, email });
      const contacts = data.contacts || [];
      if (!contacts.length) {
        showFeedback(
          'error',
          'Nenhum contato encontrado no ActiveCampaign com esses dados.'
        );
        return;
      }
      showFeedback(
        'success',
        contacts.length === 1
          ? 'Encontramos <strong>1 contato</strong>. Confirme o descadastro no card abaixo.'
          : `Encontramos <strong>${contacts.length} contatos</strong>. Trate um por vez — os outros ficam na tela.`
      );
      renderContacts(contacts);
    } catch (err) {
      showFeedback('error', escapeHtml(err.message || 'Falha na busca.'));
    } finally {
      btnSearch.disabled = false;
      btnSearch.querySelector('span').textContent = 'BUSCAR';
    }
  });

  results.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('.contact-card');
    if (!card) return;
    const action = btn.getAttribute('data-action');
    const contactId = card.getAttribute('data-id');
    const cardName = card.querySelector('h2')?.textContent?.trim() || 'este contato';

    if (action === 'cancel') {
      const ok = await askConfirm({
        title: 'Não fazer nada?',
        message: `Remover "${cardName}" da lista sem descadastrar?\n\nOs outros resultados continuam na tela.`,
        confirmLabel: 'NÃO FAZER NADA',
        cancelLabel: 'VOLTAR',
      });
      if (!ok) return;
      card.remove();
      const left = results.querySelectorAll('.contact-card').length;
      if (!left) {
        clearResults();
        clearFeedback();
      } else {
        showFeedback('success', `Card removido. Restam <strong>${left}</strong> contato(s) na lista.`);
      }
      return;
    }

    if (action !== 'confirm') return;

    const ok = await askConfirm({
      title: 'Confirmar descadastro?',
      message: `Aplicar a tag DESCADASTRAR em "${cardName}"?`,
      confirmLabel: 'DESCADASTRAR',
      cancelLabel: 'VOLTAR',
    });
    if (!ok) return;

    const buttons = card.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    btn.textContent = 'APLICANDO...';

    try {
      const data = await postJson('api/descadastrar', { contactId });
      card.remove();
      const left = results.querySelectorAll('.contact-card').length;
      const baseMsg = data.already
        ? `Contato já estava com a tag <strong>DESCADASTRAR</strong>.`
        : `Tag <strong>DESCADASTRAR</strong> aplicada em <strong>${escapeHtml(cardName)}</strong>.`;
      if (!left) {
        clearResults();
        showFeedback('success', baseMsg);
      } else {
        showFeedback('success', `${baseMsg} Restam <strong>${left}</strong> contato(s).`);
      }
    } catch (err) {
      showFeedback('error', escapeHtml(err.message || 'Falha ao aplicar tag.'));
      buttons.forEach((b) => { b.disabled = false; });
      btn.textContent = 'CONFIRMAR DESCADASTRAR';
    }
  });

  ensureSession();
})();
