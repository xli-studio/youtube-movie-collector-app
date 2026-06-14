// Clicking the toolbar icon opens the dashboard
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'http://localhost:3457' });
});
