const form = document.querySelector('#settings'), originInput = document.querySelector('#origin'), tokenInput = document.querySelector('#token'), result = document.querySelector('#result');
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
chrome.storage.local.get(['origin','token']).then(v => { originInput.value = v.origin || ''; tokenInput.value = v.token || ''; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const u = new URL(originInput.value); if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('Enter an HTTPS origin without a path.');
    const origin = u.origin, token = tokenInput.value.trim(); if (!token) throw Error('Enter a token.');
    if (!await chrome.permissions.request({origins:[origin+'/*']})) throw Error('Dashboard access was not granted.');
    const previous = await chrome.storage.local.get('origin');
    await chrome.storage.local.set({origin,token});
    if (previous.origin && previous.origin !== origin) await chrome.permissions.remove({origins:[previous.origin+'/*']});
    result.textContent = 'Saved.';
  } catch (e) { result.textContent = e.message || 'Could not save settings.'; }
});
