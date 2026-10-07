const state = document.getElementById('state');
const jobsEl = document.getElementById('jobs');
const toggle = document.getElementById('toggle');
const wipe = document.getElementById('wipe');

async function refresh() {
  const { consent = false, jobs = 0 } = await chrome.storage.local.get(['consent', 'jobs']);
  state.textContent = consent ? 'earning' : 'off';
  jobsEl.textContent = String(jobs);
  toggle.textContent = consent ? 'Stop' : 'Start earning';
}
toggle.onclick = async () => {
  const { consent = false } = await chrome.storage.local.get('consent');
  await chrome.storage.local.set({ consent: !consent });
  refresh();
};
wipe.onclick = async () => {
  await chrome.storage.local.clear();
  await caches.delete('chimera-pins');
  refresh();
};
refresh();
