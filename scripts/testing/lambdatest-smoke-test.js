const { remote } = require('webdriverio');
const fs = require('fs');
const path = require('path');

async function runTest() {
  console.log('Starting LambdaTest smoke test...');
  console.log('App ID:', process.env.LT_APP_ID);

  const browser = await remote({
    user: process.env.LT_USERNAME,
    key: process.env.LT_ACCESS_KEY,
    hostname: 'mobile-hub.lambdatest.com',
    protocol: 'https',
    port: 443,
    path: '/wd/hub',
    connectionRetryTimeout: 120000,
    capabilities: {
      'lt:options': {
        deviceName: 'Galaxy A33 5G',
        platformName: 'Android',
        platformVersion: '13',
        isRealMobile: false,
        build: `Chimera-${process.env.GITHUB_RUN_ID || 'local'}`,
        name: 'Smoke test - WebView launch',
        w3c: true,
      },
      'appium:app': process.env.LT_APP_ID,
      'appium:automationName': 'UiAutomator2',
    },
  });

  let success = false;
  let failureReason = '';

  try {
    fs.writeFileSync(path.join(__dirname, 'logcat-early.txt'), '(not captured)');
    fs.writeFileSync(path.join(__dirname, 'logcat.txt'), '(not captured)');
    fs.writeFileSync(path.join(__dirname, 'page-source.xml'), '(not captured)');

    console.log('Waiting 8s for app launch...');
    await browser.pause(8000);
    await browser.saveScreenshot(path.join(__dirname, 'screenshot-01-launch.png'));
    console.log('Screenshot 1 saved');

    try {
      const ps = await browser.getPageSource();
      fs.writeFileSync(path.join(__dirname, 'page-source.xml'), ps);
      console.log('Page source saved');
    } catch (e) { console.log('Page source error:', e.message); }

    try {
      const lc = await browser.execute('mobile: shell', { command: 'logcat', args: ['-d', '-t', '5000'] });
      fs.writeFileSync(path.join(__dirname, 'logcat-early.txt'), lc || '(empty)');
      const appLines = (lc || '').split('\n').filter(l =>
        l.includes('chimera') || l.includes('ReactNative') || l.includes('FATAL') ||
        l.includes('AndroidRuntime') || l.includes('Error') || l.includes('Hermes'));
      console.log('\n=== APP LOGCAT (' + appLines.length + ' lines) ===');
      appLines.forEach(l => console.log(l));
      console.log('=== END LOGCAT ===\n');
    } catch (e) { console.log('Logcat error:', e.message); }

    const start = Date.now();
    while (Date.now() - start < 120000) {
      await browser.pause(5000);
      try {
        const wv = await browser.$('//android.webkit.WebView');
        if (await wv.isExisting()) {
          console.log('WebView found!');
          await browser.pause(3000);
          await browser.saveScreenshot(path.join(__dirname, 'screenshot-03-webview.png'));
          success = true;
          break;
        }
        console.log('WebView not found yet...');
      } catch (e) { console.log('WebView check error:', e.message); }
    }

    if (!success) failureReason = 'Timed out waiting for WebView';

    try {
      const lc = await browser.execute('mobile: shell', { command: 'logcat', args: ['-d', '-t', '2000'] });
      fs.writeFileSync(path.join(__dirname, 'logcat.txt'), lc || '(empty)');
      if (lc) { console.log('\n=== FULL LOGCAT ===\n' + lc + '\n=== END ==='); }
    } catch (e) {}
  } catch (e) {
    console.error('Test error:', e);
    failureReason = e.message;
  } finally {
    try { await browser.deleteSession(); } catch (e) {}
  }

  if (success) { console.log('\n=== TEST PASSED ==='); process.exit(0); }
  else { console.log('\n=== TEST FAILED ===\nReason:', failureReason); process.exit(1); }
}

runTest();
