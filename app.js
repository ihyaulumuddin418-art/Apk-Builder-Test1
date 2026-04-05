// ============================================================
//  APK Builder — app.js
//  Metode: Upload file ke repo dulu, baru trigger workflow
// ============================================================

const state = {
  ghUsername: '',
  ghToken: '',
  ghRepo: '',
  ghVisibility: 'public',
  connected: false,
  iconBase64: null,
  uploadedFiles: [],
  history: [],
};

// ---- INIT ----
window.addEventListener('DOMContentLoaded', () => {
  // Load saved non-sensitive settings
  document.getElementById('ghUsername').value = localStorage.getItem('gh_username') || '';
  document.getElementById('ghRepo').value = localStorage.getItem('gh_repo') || '';

  // Load history (without icons to save space)
  try {
    state.history = JSON.parse(localStorage.getItem('apk_history') || '[]');
  } catch(e) {
    state.history = [];
  }
  renderHistory();
});

// ============================================================
//  GITHUB CONNECT
// ============================================================
async function connectGitHub() {
  const username = document.getElementById('ghUsername').value.trim();
  const token = document.getElementById('ghToken').value.trim();
  const repo = document.getElementById('ghRepo').value.trim();
  const visibility = document.getElementById('ghVisibility').value;

  if (!username) return showToast('⚠️ Masukkan GitHub Username!', 'error');
  if (!token) return showToast('⚠️ Masukkan Personal Access Token!', 'error');
  if (!repo) return showToast('⚠️ Masukkan Repository Name!', 'error');

  showToast('🔄 Menghubungkan...', 'info');

  try {
    const res = await ghFetch(`repos/${username}/${encodeURIComponent(repo)}`, token);

    if (res.ok) {
      setConnected(username, token, repo, visibility);
      showToast('✅ Terhubung ke GitHub!', 'success');
    } else if (res.status === 404) {
      showToast('📁 Repo tidak ditemukan, membuat repo baru...', 'info');
      await createRepo(username, token, repo, visibility);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast('❌ ' + (err.message || 'Token tidak valid!'), 'error');
    }
  } catch (e) {
    showToast('❌ Network error!', 'error');
  }
}

async function createRepo(username, token, repo, visibility) {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({ name: repo, private: visibility === 'private', auto_init: true })
  });

  if (res.status === 201) {
    setConnected(username, token, repo, visibility);
    showToast('✅ Repo dibuat & terhubung!', 'success');
  } else {
    const err = await res.json().catch(() => ({}));
    showToast('❌ Gagal buat repo: ' + (err.message || ''), 'error');
  }
}

function setConnected(username, token, repo, visibility) {
  state.ghUsername = username;
  state.ghToken = token;
  state.ghRepo = repo;
  state.ghVisibility = visibility;
  state.connected = true;
  localStorage.setItem('gh_username', username);
  localStorage.setItem('gh_repo', repo);
  setTokenStatus(true);
}

function setTokenStatus(connected) {
  const el = document.getElementById('tokenStatus');
  if (connected) {
    el.innerHTML = '<span class="dot dot-on"></span> Terhubung';
    el.style.color = 'var(--success)';
  } else {
    el.innerHTML = '<span class="dot dot-off"></span> Belum terhubung';
    el.style.color = '';
  }
}

function toggleToken() {
  const inp = document.getElementById('ghToken');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ============================================================
//  GITHUB API HELPERS
// ============================================================
function ghHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

async function ghFetch(path, token, options = {}) {
  return fetch(`https://api.github.com/${path}`, {
    ...options,
    headers: { ...ghHeaders(token), ...(options.headers || {}) },
  });
}

// ============================================================
//  AUTO WORKFLOW GENERATOR
//  Workflow dibuat otomatis sesuai file yang diupload
// ============================================================
function generateWorkflow(appName, packageName, version, fileNames) {
  // Deteksi tipe project dari file yang diupload
  const hasCSS = fileNames.some(f => f.endsWith('.css'));
  const hasJS = fileNames.some(f => f.endsWith('.js'));
  const hasImages = fileNames.some(f => /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(f));

  const fileList = fileNames.map(f => `www/${f}`).join(' ');

  return `name: Build APK

on:
  workflow_dispatch:
    inputs:
      app_name:
        description: 'App Name'
        required: true
        default: '${appName}'
      package_name:
        description: 'Package Name'
        required: true
        default: '${packageName}'
      version:
        description: 'Version'
        required: true
        default: '${version}'

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Android SDK
        uses: android-actions/setup-android@v3

      - name: Install Capacitor CLI
        run: npm install -g @capacitor/cli

      - name: Init project
        run: |
          mkdir -p apk_project
          cd apk_project
          npm init -y
          npm install @capacitor/core @capacitor/android

      - name: Copy web files
        run: |
          mkdir -p apk_project/www
          cp -r www/. apk_project/www/
          echo "Files copied:"
          ls apk_project/www/

      - name: Init Capacitor
        run: |
          cd apk_project
          npx cap init "\${{ github.event.inputs.app_name }}" "\${{ github.event.inputs.package_name }}" --web-dir www

      - name: Add Android platform
        run: |
          cd apk_project
          npx cap add android

      - name: Sync web files to Android
        run: |
          cd apk_project
          npx cap sync

      - name: Build debug APK
        run: |
          cd apk_project/android
          chmod +x gradlew
          ./gradlew assembleDebug --no-daemon --no-build-cache --rerun-tasks

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: apk_project/android/app/build/outputs/apk/debug/app-debug.apk
          retention-days: 7
`;
}

// ============================================================
//  UPLOAD WORKFLOW TO REPO
// ============================================================
async function uploadWorkflowToRepo(appName, packageName, version, fileNames) {
  const { ghUsername: u, ghToken: t, ghRepo: r } = state;
  const workflowContent = generateWorkflow(appName, packageName, version, fileNames);
  const encoded = btoa(unescape(encodeURIComponent(workflowContent)));
  const path = `.github/workflows/build.yml`;

  addLog('info', '→ Mengecek workflow di repo...');

  // Check if exists to get SHA
  let sha = null;
  try {
    const check = await ghFetch(`repos/${u}/${encodeURIComponent(r)}/contents/${path}`, t);
    if (check.ok) {
      const data = await check.json();
      sha = data.sha;
      addLog('info', '→ Workflow lama ditemukan, akan diupdate...');
    }
  } catch(e) { /* not found, will create */ }

  // Upload / update workflow
  const body = {
    message: sha ? 'Update APK build workflow' : 'Add APK build workflow',
    content: encoded,
  };
  if (sha) body.sha = sha;

  const res = await ghFetch(`repos/${u}/${encodeURIComponent(r)}/contents/${path}`, t, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (res.ok || res.status === 201) {
    addLog('ok', '✓ Workflow berhasil disiapkan!');
    return true;
  } else {
    const err = await res.json().catch(() => ({}));
    addLog('err', '✗ Gagal upload workflow: ' + (err.message || res.status));
    return false;
  }
}

// ============================================================
//  UPLOAD WEB FILES TO REPO
// ============================================================
async function uploadFilesToRepo(files) {
  const { ghUsername: u, ghToken: t, ghRepo: r } = state;
  addLog('info', `→ Mengupload ${files.length} file ke repo...`);

  for (const file of files) {
    const b64 = await fileToBase64(file);
    const content = b64.split(',')[1];
    const path = `www/${file.name}`;

    // Check if file exists to get SHA
    let sha = null;
    try {
      const check = await ghFetch(`repos/${u}/${encodeURIComponent(r)}/contents/${path}`, t);
      if (check.ok) {
        const data = await check.json();
        sha = data.sha;
      }
    } catch(e) { /* not found */ }

    const body = {
      message: `Add ${file.name}`,
      content: content,
    };
    if (sha) body.sha = sha;

    const res = await ghFetch(`repos/${u}/${encodeURIComponent(r)}/contents/${path}`, t, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    if (res.ok || res.status === 201) {
      addLog('ok', `✓ ${file.name} (${formatSize(file.size)})`);
    } else {
      const err = await res.json().catch(() => ({}));
      addLog('err', `✗ Gagal upload ${file.name}: ` + (err.message || ''));
      return false;
    }
  }

  addLog('ok', '✓ Semua file berhasil diupload!');
  return true;
}

// ============================================================
//  ICON HANDLER
// ============================================================
function handleIcon(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    state.iconBase64 = e.target.result;
    const preview = document.getElementById('iconPreview');
    preview.innerHTML = `<img src="${state.iconBase64}" alt="icon" />`;
    document.getElementById('iconName').textContent = file.name;
  };
  reader.readAsDataURL(file);
}

// ============================================================
//  FILE HANDLERS
// ============================================================
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.add('dragover');
}

function handleDragLeave(e) {
  document.getElementById('dropzone').classList.remove('dragover');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
}

function handleFiles(files) {
  for (const file of files) {
    if (state.uploadedFiles.find(f => f.name === file.name)) continue;
    state.uploadedFiles.push(file);
  }
  renderFileList();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  document.getElementById('fileCount').textContent = state.uploadedFiles.length + ' file';

  if (state.uploadedFiles.length === 0) { list.innerHTML = ''; return; }

  list.innerHTML = state.uploadedFiles.map((f, i) => {
    const ext = f.name.includes('.') ? f.name.split('.').pop().toUpperCase() : 'FILE';
    const isMain = f.name === 'index.html';
    return `
      <div class="file-item ${isMain ? '' : ''}">
        <span class="file-ext">${ext}</span>
        <span class="file-name ${isMain ? 'main-file' : ''}">${f.name}${isMain ? ' ⭐' : ''}</span>
        <span class="file-size">${formatSize(f.size)}</span>
        <button class="file-remove" onclick="removeFile(${i})">×</button>
      </div>`;
  }).join('');
}

function removeFile(i) {
  state.uploadedFiles.splice(i, 1);
  renderFileList();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleVersionChange() {
  const sel = document.getElementById('appVersion').value;
  document.getElementById('customVersionGroup').style.display = sel === 'custom' ? 'flex' : 'none';
}

function getVersion() {
  const sel = document.getElementById('appVersion').value;
  return sel === 'custom' ? (document.getElementById('customVersion').value.trim() || '1.0.0') : sel;
}

// ============================================================
//  BUILD
// ============================================================
async function startBuild() {
  const appName = document.getElementById('appName').value.trim();
  const packageName = document.getElementById('packageName').value.trim();
  const version = getVersion();

  // Validasi
  if (!state.connected) return showToast('⚠️ Hubungkan GitHub dulu!', 'error');
  if (!appName) return showToast('⚠️ Masukkan nama app!', 'error');
  if (!packageName) return showToast('⚠️ Masukkan package name!', 'error');
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
    return showToast('⚠️ Package name tidak valid! Contoh: com.nama.app', 'error');
  }
  if (state.uploadedFiles.length === 0) return showToast('⚠️ Upload minimal 1 file!', 'error');

  // Cek index.html
  const hasIndex = state.uploadedFiles.some(f => f.name === 'index.html');
  if (!hasIndex) return showToast('⚠️ Harus ada file index.html!', 'error');

  document.getElementById('buildBtn').disabled = true;
  document.getElementById('buildStatusCard').style.display = 'block';
  setProgress(5, 'Memulai build...', 'running');
  addLog('info', `→ App: ${appName} | v${version} | ${packageName}`);
  addLog('info', `→ File: ${state.uploadedFiles.length} file`);

  const fileNames = state.uploadedFiles.map(f => f.name);

  // STEP 1: Upload web files ke repo
  setProgress(15, 'Mengupload file ke repo...', 'running');
  const filesOk = await uploadFilesToRepo(state.uploadedFiles);
  if (!filesOk) {
    setProgress(0, 'Gagal upload file!', 'error');
    document.getElementById('buildBtn').disabled = false;
    return;
  }

  // STEP 2: Upload/update workflow otomatis
  setProgress(35, 'Menyiapkan workflow...', 'running');
  const workflowOk = await uploadWorkflowToRepo(appName, packageName, version, fileNames);
  if (!workflowOk) {
    setProgress(0, 'Gagal upload workflow!', 'error');
    document.getElementById('buildBtn').disabled = false;
    return;
  }

  // Tunggu sebentar biar GitHub siap
  await sleep(3000);

  // STEP 3: Trigger GitHub Actions
  setProgress(45, 'Memulai GitHub Actions...', 'running');
  addLog('info', '→ Mentrigger build...');

  try {
    const res = await ghFetch(
      `repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/workflows/build.yml/dispatches`,
      state.ghToken,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: 'main',
          inputs: { app_name: appName, package_name: packageName, version }
        })
      }
    );

    if (res.status === 204) {
      addLog('ok', '✓ Build berhasil di-trigger!');
      setProgress(50, 'Build berjalan di GitHub...', 'running');

      // Tambah ke history
      const buildId = Date.now();
      state.history.unshift({
        id: buildId, appName, packageName, version,
        status: 'building', date: new Date().toLocaleString('id-ID'), runId: null,
      });
      saveHistory();
      renderHistory();

      // Mulai polling setelah 20 detik
      setTimeout(() => pollBuild(buildId, 0), 20000);
    } else {
      const err = await res.json().catch(() => ({}));
      addLog('err', '✗ Gagal trigger: ' + (err.message || res.status));
      setProgress(0, 'Gagal trigger build!', 'error');
      document.getElementById('buildBtn').disabled = false;
    }
  } catch (e) {
    addLog('err', '✗ ' + e.message);
    setProgress(0, 'Network error!', 'error');
    document.getElementById('buildBtn').disabled = false;
  }
}

// ============================================================
//  POLLING BUILD STATUS
// ============================================================
async function pollBuild(buildId, attempt) {
  if (attempt > 40) {
    addLog('err', '✗ Timeout — cek GitHub Actions manual');
    setProgress(0, 'Timeout', 'error');
    document.getElementById('buildBtn').disabled = false;
    return;
  }

  const progress = Math.min(90, 50 + attempt * 1.5);
  setProgress(progress, `Build berjalan... (${(attempt + 1) * 20}s)`, 'running');
  addLog('info', `→ Cek status... attempt ${attempt + 1}`);

  try {
    const res = await ghFetch(
      `repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/runs?per_page=5`,
      state.ghToken
    );
    const data = await res.json();
    const run = data.workflow_runs?.find(r => r.name === 'Build APK');
    if (!run) {
      setTimeout(() => pollBuild(buildId, attempt + 1), 20000);
      return;
    }

    // Simpan runId
    const idx = state.history.findIndex(b => b.id === buildId);
    if (idx >= 0 && !state.history[idx].runId) {
      state.history[idx].runId = run.id;
      saveHistory();
      renderHistory();
    }

    if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        addLog('ok', '✓ Build sukses!');
        setProgress(100, '✅ Build selesai!', 'success');
        updateHistoryStatus(buildId, 'success');
        await downloadAPK(run.id, buildId, document.getElementById('appName').value);
      } else {
        addLog('err', '✗ Build gagal: ' + run.conclusion);
        setProgress(0, '❌ Build gagal', 'error');
        updateHistoryStatus(buildId, 'failed');
        document.getElementById('buildBtn').disabled = false;
      }
    } else {
      setTimeout(() => pollBuild(buildId, attempt + 1), 20000);
    }
  } catch (e) {
    addLog('err', '! ' + e.message);
    setTimeout(() => pollBuild(buildId, attempt + 1), 20000);
  }
}

// ============================================================
//  DOWNLOAD APK
// ============================================================
async function downloadAPK(runId, buildId, appName) {
  addLog('info', '→ Mengambil APK...');
  try {
    const res = await ghFetch(
      `repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/runs/${runId}/artifacts`,
      state.ghToken
    );
    const data = await res.json();
    const artifact = data.artifacts?.find(a => a.name === 'app-debug');
    if (!artifact) { addLog('err', '✗ Artifact tidak ditemukan'); return; }

    const dlRes = await fetch(
      `https://api.github.com/repos/${state.ghUsername}/${encodeURIComponent(state.ghRepo)}/actions/artifacts/${artifact.id}/zip`,
      { headers: { 'Authorization': `Bearer ${state.ghToken}` } }
    );

    const blob = await dlRes.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (appName || 'app').replace(/\s+/g, '-') + '-debug.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    addLog('ok', '✓ APK berhasil diunduh!');
    showToast('🎉 APK berhasil diunduh!', 'success');
    document.getElementById('buildBtn').disabled = false;
  } catch (e) {
    addLog('err', '✗ ' + e.message);
    document.getElementById('buildBtn').disabled = false;
  }
}

// ============================================================
//  HISTORY
// ============================================================
function saveHistory() {
  state.history = state.history.slice(0, 20);
  const toSave = state.history.map(item => ({ ...item, icon: null }));
  try { localStorage.setItem('apk_history', JSON.stringify(toSave)); } catch(e) { /* quota */ }
}

function updateHistoryStatus(buildId, status) {
  const idx = state.history.findIndex(b => b.id === buildId);
  if (idx >= 0) { state.history[idx].status = status; saveHistory(); renderHistory(); }
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (state.history.length === 0) {
    list.innerHTML = `<div class="empty-state"
