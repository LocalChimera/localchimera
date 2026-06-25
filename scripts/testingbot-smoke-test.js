const { remote } = require('webdriverio');
const fs = require('fs');
const path = require('path');

async function runTest() {
  console.log('Starting TestingBot smoke test...');
  console.log('App URL:', process.env.TESTINGBOT_APP_URL);

  const browser = await remote({
    user: process.env.TESTINGBOT_KEY,
    key: process.env.TESTINGBOT_SECRET,
    hostname: 'hub.testingbot.com',
    protocol: 'https',
    port: 443,
    path: '/wd/hub',
    connectionRetryTimeout: 120000,
    capabilities: {
      'tb:options': {
        name: 'Chimera Smoke Test',
        build: `build-${process.env.GITHUB_RUN_ID || 'local'}`,
      },
      platformName: 'Android',
      'appium:app': process.env.TESTINGBOT_APP_URL,
      'appium:deviceName': 'Pixel 6',
      'appium:platformVersion': '12',
      'appium:automationName': 'UiAutomator2',
    },
  });

  let success = false;
  let failureReason = '';

  try {
    await browser.pause(5000);
    await browser.saveScreenshot(path.join(__dirname, 'screenshot-01-launch.png'));
    console.log('Screenshot 1: app launched');

    let enableAIBtn = null;
    const selectors = [
      '//*[contains(@text, "Enable AI")]',
      '//*[contains(@text, "enable ai")]',
      '//android.widget.Button[contains(@text, "Enable")]',
      '//android.widget.TextView[contains(@text, "Enable")]',
      'android=new UiSelector().textContains("Enable")',
    ];

    for (const sel of selectors) {
      try {
        const el = await browser.$(sel);
        if (await el.isExisting()) {
          enableAIBtn = el;
          console.log('Found Enable AI button with selector:', sel);
          break;
        }
      } catch (e) {}
    }

    if (enableAIBtn) {
      try {
        await browser.execute('mobile: shell', { command: 'logcat', args: ['-c'] });
        console.log('Logcat cleared');
      } catch (e) { console.log('Could not clear logcat:', e.message); }

      await enableAIBtn.click();
      console.log('Tapped Enable AI button');
      await browser.pause(3000);
      await browser.saveScreenshot(path.join(__dirname, 'screenshot-02-after-tap.png'));

      const startTime = Date.now();
      while (Date.now() - startTime < 180000) {
        await browser.saveScreenshot(path.join(__dirname, 'screenshot-03-checking.png'));

        try {
          const ready = await browser.$('//*[contains(@text, "ready") or contains(@text, "Ready")]');
          if (await ready.isExisting()) {
            console.log('SUCCESS: Model loaded successfully');
            success = true;
            break;
          }
        } catch (e) {}

        try {
          const errorEl = await browser.$('//*[contains(@text, "error") or contains(@text, "Error") or contains(@text, "failed")]');
          if (await errorEl.isExisting()) {
            const txt = await errorEl.getText();
            console.log('Model load error text:', txt);
            failureReason = txt;
            break;
          }
        } catch (e) {}

        try {
          const loading = await browser.$('//*[contains(@text, "loading") or contains(@text, "Loading")]');
          if (await loading.isExisting()) {
            const txt = await loading.getText();
            console.log('Still loading:', txt);
          }
        } catch (e) {}

        await browser.pause(4000);
      }

      if (!success && !failureReason) {
        failureReason = 'Timed out waiting for model load result';
      }

      try {
        const logcat = await browser.execute('mobile: shell', { command: 'logcat', args: ['-d', '-t', '500'] });
        fs.writeFileSync(path.join(__dirname, 'logcat.txt'), logcat || '(empty)');
        console.log('Logcat saved to logcat.txt');
      } catch (e) { console.log('Could not capture logcat:', e.message); }
    } else {
      await browser.saveScreenshot(path.join(__dirname, 'screenshot-02-no-button.png'));
      failureReason = 'Enable AI button not found';
      console.log('Enable AI button not found');
      try {
        const source = await browser.getPageSource();
        fs.writeFileSync(path.join(__dirname, 'page-source.xml'), source);
        console.log('Page source saved to page-source.xml');
      } catch (e) {}
    }
  } catch (e) {
    console.error('Test error:', e);
    failureReason = e.message;
  } finally {
    await browser.deleteSession();
  }

  if (success) {
    console.log('\n=== TEST PASSED ===');
    process.exit(0);
  } else {
    console.log('\n=== TEST FAILED ===');
    console.log('Reason:', failureReason);
    process.exit(1);
  }
}

runTest();
