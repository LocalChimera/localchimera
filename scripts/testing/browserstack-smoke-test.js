const { remote } = require('webdriverio');
const fs = require('fs');
const path = require('path');

async function createSession(retries = 4) {
  const devices = [
    { deviceName: 'Google Pixel 6', osVersion: '12.0' },
    { deviceName: 'Google Pixel 7', osVersion: '13.0' },
    { deviceName: 'Google Pixel 6', osVersion: '12.0' },
    { deviceName: 'Google Pixel 7', osVersion: '13.0' },
  ];

  for (let attempt = 0; attempt < retries; attempt++) {
    const device = devices[attempt % devices.length];
    console.log(`\nAttempt ${attempt + 1}/${retries}: Trying device ${device.deviceName} (${device.osVersion})`);

    try {
      const browser = await remote({
        user: process.env.BROWSERSTACK_USERNAME,
        key: process.env.BROWSERSTACK_ACCESS_KEY,
        hostname: 'hub-cloud.browserstack.com',
        protocol: 'https',
        port: 443,
        path: '/wd/hub',
        connectionRetryTimeout: 300000,
        connectionRetryCount: 1,
        capabilities: {
          'bstack:options': {
            osVersion: device.osVersion,
            deviceName: device.deviceName,
            projectName: 'Chimera',
            buildName: `build-${process.env.GITHUB_RUN_ID || 'local'}`,
            sessionName: 'Smoke test - Enable AI button',
            debug: true,
            networkLogs: true,
          },
          'appium:app': process.env.BROWSERSTACK_APP_URL,
          'appium:automationName': 'UiAutomator2',
          'appium:newCommandTimeout': 300,
          'appium:appWaitForLaunch': true,
          'appium:appWaitDuration': 180000,
          'appium:androidInstallTimeout': 180000,
        },
      });
      console.log(`Successfully connected on ${device.deviceName}`);
      return browser;
    } catch (e) {
      console.log(`Attempt ${attempt + 1} failed: ${e.message}`);
      if (attempt < retries - 1) {
        console.log('Waiting 30s before retry...');
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }
  throw new Error('Failed to create BrowserStack session after all retries');
}

async function runTest() {
  console.log('Starting BrowserStack smoke test...');
  console.log('App URL:', process.env.BROWSERSTACK_APP_URL);

  const browser = await createSession(4);

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
      // Clear logcat before tapping
      try {
        await browser.execute('mobile: shell', { command: 'logcat', args: ['-c'] });
        console.log('Logcat cleared');
      } catch (e) { console.log('Could not clear logcat:', e.message); }

      await enableAIBtn.click();
      console.log('Tapped Enable AI button');
      await browser.pause(3000);
      await browser.saveScreenshot(path.join(__dirname, 'screenshot-02-after-tap.png'));

      const startTime = Date.now();
      while (Date.now() - startTime < 90000) {
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

      // Capture logcat after test
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
    const sessionId = browser.sessionId;
    console.log("BrowserStack session ID:", sessionId);
    try { fs.writeFileSync(path.join(__dirname, "session-id.txt"), sessionId || ""); } catch (e) {}
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
