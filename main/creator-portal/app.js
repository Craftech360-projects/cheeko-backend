const state = {
  token: localStorage.getItem('creatorPortal.token') || '',
  lastDraftId: localStorage.getItem('creatorPortal.lastDraftId') || '',
  lastGenerationJobId: localStorage.getItem('creatorPortal.lastGenerationJobId') || '',
  creatorSessionId: localStorage.getItem('creatorPortal.creatorSessionId') || crypto.randomUUID(),
};

const DEFAULT_API_BASE_URL = 'http://localhost:8002/toy';

const $ = (id) => document.getElementById(id);

localStorage.setItem('creatorPortal.creatorSessionId', state.creatorSessionId);

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const readableStatus = (status = '') => status
  .split('_')
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const setBusy = (button, busyText) => {
  if (!button) return () => {};

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;

  return () => {
    button.disabled = false;
    button.textContent = originalText;
  };
};

const runAction = async (button, busyText, action) => {
  const restore = setBusy(button, busyText);
  try {
    await action();
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    restore();
  }
};

const showMessage = (text, type = 'success') => {
  const el = document.createElement('div');
  el.className = `message ${type}`;
  el.textContent = text;
  $('messages').prepend(el);
  setTimeout(() => el.remove(), 5500);
};

const getApiBase = () => (
  window.CHEEKO_CREATOR_API_BASE ||
  localStorage.getItem('creatorPortal.apiBaseUrl') ||
  DEFAULT_API_BASE_URL
).trim().replace(/\/$/, '');
const getStorageBase = () => getApiBase().replace(/\/toy$/, '');
const authHeaders = () => state.token ? { Authorization: state.token } : {};

const apiFetch = async (path, options = {}) => {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      'X-Creator-Session-Id': state.creatorSessionId,
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0) {
    throw new Error(data.msg || `Request failed with status ${res.status}`);
  }
  return data.data;
};

const createDraftAndUpload = async () => {
  const payload = {
    title: $('title').value.trim(),
    description: $('description').value.trim(),
    contentType: $('contentType').value,
    language: $('language').value.trim() || 'en',
    category: $('category').value.trim(),
    sourceType: 'upload',
  };

  if (!payload.title) {
    throw new Error('Add a title before creating the draft.');
  }

  const audioFile = $('audioFile').files[0];
  const coverFile = $('coverFile').files[0];

  if (!audioFile || !coverFile) {
    throw new Error('Please add both an audio file and a cover image.');
  }

  const draft = await apiFetch('/creator/content', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const formData = new FormData();
  formData.append('audio', audioFile);
  formData.append('coverImage', coverFile);

  await apiFetch(`/creator/content/${draft.id}/assets`, {
    method: 'POST',
    body: formData,
  });

  state.lastDraftId = String(draft.id);
  localStorage.setItem('creatorPortal.lastDraftId', state.lastDraftId);
  showMessage(`Draft ${draft.id} created. You can submit it when ready.`);
  await loadMyContent();
};

const startGeneration = async () => {
  const payload = {
    title: $('genTitle').value.trim(),
    topic: $('genTopic').value.trim(),
    description: $('genDescription').value.trim(),
    contentType: $('genContentType').value,
    language: $('genLanguage').value.trim() || 'en',
    category: $('genCategory').value.trim(),
    generationMode: $('genMode').value,
    stepCount: Number($('genStepCount').value || 10),
    esp32Mode: $('genEsp32').checked,
  };

  if (!payload.title) {
    throw new Error('Add a generated draft title first.');
  }

  if (!payload.topic) {
    throw new Error('Add a topic so the generator knows what to create.');
  }

  const result = await apiFetch('/creator/generation', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  state.lastDraftId = String(result.submission.id);
  state.lastGenerationJobId = String(result.job.id);
  localStorage.setItem('creatorPortal.lastDraftId', state.lastDraftId);
  localStorage.setItem('creatorPortal.lastGenerationJobId', state.lastGenerationJobId);

  showMessage(`Generation started for draft ${result.submission.id}. Refresh My Content to see progress.`);
  await loadMyContent();
};

const retryLastGeneration = async () => {
  if (!state.lastGenerationJobId) {
    throw new Error('No generation job is stored in this browser session.');
  }

  const result = await apiFetch(`/creator/generation/${state.lastGenerationJobId}/retry`, {
    method: 'POST',
  });

  state.lastGenerationJobId = String(result.id);
  localStorage.setItem('creatorPortal.lastGenerationJobId', state.lastGenerationJobId);
  showMessage(`Generation job ${result.id} queued for retry.`);
  await loadMyContent();
};

const submitLastDraft = async () => {
  if (!state.lastDraftId) {
    throw new Error('Create or select a draft first. This button submits the latest draft in this browser.');
  }

  await apiFetch(`/creator/content/${state.lastDraftId}/submit-review`, {
    method: 'POST',
  });

  showMessage(`Draft ${state.lastDraftId} submitted for review.`);
  await Promise.all([loadMyContent(), loadReviewQueue()]);
};

const formatAssets = (assets = []) => {
  if (!assets.length) return '';

  return `
    <div class="asset-links" aria-label="Draft assets">
      ${assets.map((asset) => {
        const href = asset.localPath ? `${getStorageBase()}/${asset.localPath}` : '';
        return `
          <span class="pill">${escapeHtml(asset.assetType)}</span>
          ${asset.awsUrl ? `<a href="${escapeHtml(asset.awsUrl)}" target="_blank" rel="noreferrer">AWS URL</a>` : ''}
          ${asset.localPath ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">Draft File</a>` : ''}
        `;
      }).join('')}
    </div>
  `;
};

const formatGeneratedItems = (submission) => {
  const generatedItems = submission.metadata?.generatedItems || [];
  const uploadedGeneratedItems = submission.metadata?.uploadedGeneratedItems || [];
  const items = uploadedGeneratedItems.length ? uploadedGeneratedItems : generatedItems;

  if (!items.length) {
    return '';
  }

  return `
    <div class="generated-list" aria-label="Generated content steps">
      ${items.map((item) => {
        const audioHref = item.audioUrl || (item.audioPath ? `${getStorageBase()}/${item.audioPath}` : '');
        const imageHref = item.imageUrl || (item.imagePath ? `${getStorageBase()}/${item.imagePath}` : '');

        return `
          <div class="generated-item">
            <strong>Step ${escapeHtml(item.step || item.itemNumber || '')}: ${escapeHtml(item.title || 'Generated item')}</strong>
            ${item.text ? `<p>${escapeHtml(item.text)}</p>` : ''}
            <div class="asset-links">
              ${audioHref ? `<a href="${escapeHtml(audioHref)}" target="_blank" rel="noreferrer">${item.audioUrl ? 'AWS Audio' : 'Draft Audio'}</a>` : ''}
              ${imageHref ? `<a href="${escapeHtml(imageHref)}" target="_blank" rel="noreferrer">${item.imageUrl ? 'AWS Image' : 'Draft Image'}</a>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
};

const renderSubmission = (submission, includeReviewActions = false) => {
  const statusClass = `status-${String(submission.status || '').toLowerCase()}`;
  const generatedDetail = submission.metadata?.generatedTopic ? `
    <div class="detail-box">
      <strong>Generated topic:</strong> ${escapeHtml(submission.metadata.generatedTopic)}
      <span class="meta-text">Mode: ${escapeHtml(submission.metadata.generationMode || 'n/a')}</span>
    </div>
  ` : '';

  const reviewNotes = submission.reviewNotes ? `
    <div class="detail-box">
      <strong>Review notes:</strong> ${escapeHtml(submission.reviewNotes)}
    </div>
  ` : '';

  const reviewButtons = includeReviewActions ? `
    <div class="review-actions">
      <button data-action="approve" data-id="${submission.id}" type="button" class="btn primary">Approve</button>
      <button data-action="reject" data-id="${submission.id}" type="button" class="btn secondary">Reject</button>
      <button data-action="upload" data-id="${submission.id}" type="button" class="btn ghost">Upload to AWS</button>
    </div>
  ` : '';

  return `
    <article class="content-card">
      <div class="content-card-header">
        <div>
          <h3>${escapeHtml(submission.title)}</h3>
          <div class="meta-row">
            <span class="pill ${statusClass}">${escapeHtml(readableStatus(submission.status))}</span>
            <span class="pill">${escapeHtml(submission.contentType)}</span>
            <span class="meta-text">${escapeHtml(submission.language || 'en')}</span>
            <span class="meta-text">Source: ${escapeHtml(submission.sourceType)}</span>
          </div>
        </div>
        <div class="submission-id">#${escapeHtml(submission.id)}</div>
      </div>

      <p class="description-text">${escapeHtml(submission.description || 'No description added yet.')}</p>
      <div class="meta-text">Category: ${escapeHtml(submission.category || 'None')}</div>
      ${generatedDetail}
      ${reviewNotes}
      ${formatAssets(submission.assets)}
      ${formatGeneratedItems(submission)}
      ${reviewButtons}
    </article>
  `;
};

const emptyState = (title, body) => `
  <div class="empty-state">
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
    </div>
  </div>
`;

const loadMyContent = async () => {
  const data = await apiFetch('/creator/content/my');
  $('myContentList').innerHTML = data.list.length
    ? data.list.map((item) => renderSubmission(item)).join('')
    : emptyState('No drafts yet', 'Upload content or generate a draft to start your first submission.');
};

const switchTab = (button) => {
  document.querySelectorAll('.nav-link').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));
  button.classList.add('active');
  $(button.dataset.tab).classList.add('active');
  $('messages').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const bindEvents = () => {
  $('createDraftBtn').addEventListener('click', (event) => runAction(event.currentTarget, 'Creating...', createDraftAndUpload));
  $('submitReviewBtn').addEventListener('click', (event) => runAction(event.currentTarget, 'Submitting...', submitLastDraft));
  $('startGenerationBtn').addEventListener('click', (event) => runAction(event.currentTarget, 'Starting...', startGeneration));
  $('submitGeneratedBtn').addEventListener('click', (event) => runAction(event.currentTarget, 'Submitting...', submitLastDraft));
  $('refreshMineBtn').addEventListener('click', (event) => runAction(event.currentTarget, 'Refreshing...', loadMyContent));

  document.querySelectorAll('.nav-link').forEach((button) => {
    button.addEventListener('click', () => switchTab(button));
  });

  document.addEventListener('keydown', async (event) => {
    if (event.altKey && event.key.toLowerCase() === 'r') {
      await runAction(null, 'Retrying...', retryLastGeneration);
    }
  });
};

bindEvents();
loadMyContent().catch(() => {});
