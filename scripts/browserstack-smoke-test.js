const { remote } = require('webdriverio');
const fs = require('fs');
const path = require('path');

async function runTest() {
  console.log('Starting BrowserStack smoke test...');
  console.log('App URL:', process.env.BROWSERSTACK_APP_URL);

  const browser = await remote({
    user: process.env.BROWSERSTACK_USERNAME,
    key: process.env.BROWSERSTACK_ACCESS_KEY,
    hostname: 'hub-cloud.browserstack.com',
    protocol: 'https',
    port: 443,
    path: '/wd/hub',
    capabilities: {
      'bstack:options': {
        osVersion: '13.0',
        deviceName: 'Google Pixel 6',
        projectName: 'Chimera',
        buildName: `build-${process.env.GITHUB_RUN_ID || 'local'}`,
        sessionName: 'Smoke test - Enable AI button',
        debug: true,
        networkLogs: true,
      },
      'appium:app': process.env.BROWSERSTACK_APP_URL,
      'appium:automationName': 'UiAutomator2',
    },
  });

  let success = false;
  let failureReason = '';

  try {
    // Wait for app to load and screenshot
    await browser.pause(4000);
    await browser.saveScreenshot(path.join(__dirname, 'screenshot-01-launch.png'));
    console.log('Screenshot 1: app launched');

    // Try to find "Enable AI" button by text
    let enableAIBtn = null;
    const selectors = [
      '//*[contains(@text, "Enable AI")]',
      '//*[contains(@text, "enable ai")]',
      '//android.widget.Button[contains(@text, "Enable")]',
      '//android.widget.TextView[contains(@text, "Enable")]',
    ];

    for (const sel of selectors) {
      try {
        const el = await browser.$(sel);
        if (await el.isExisting()) {
          enableAIBtn = el;
          console.log('Found Enable AI button with selector:', sel);
          break;
        }
      } catch (e) {
        // try next selector
      }
    }

    if (enableAIBtn) {
      await enableAIBtn.click();
      console.log('Tapped Enable AI button');
      await browser.pause(3000);
      await browser.saveScreenshot(path.join(__dirname, 'screenshot-02-after-tap.png'));

      // Wait for model to load or error (up to 60s)
      const startTime = Date.now();
      while (Date.now() - startTime < 60000) {
        await browser.saveScreenshot(path.join(__dirname, 'screenshot-03-checking.png'));

        // Check for "ready"
        try {
          const ready = await browser.$('//*[contains(@text, "ready") or contains(@text, "Ready")]');
          if (await ready.isExisting()) {
            console.log('SUCCESS: Model loaded successfully');
            success = true;
            break;
          }
        } catch (e) {}

        // Check for "error"
        try {
          const errorEl = await browser.$('//*[contains(@text, "error") or contains(@text, "Error") or contains(@text, "failed")]');
          if (await errorEl.isExisting()) {
            const txt = await errorEl.getText();
            console.log('Model load error text:', txt);
            failureReason = txt;
            break;
          }
        } catch (e) {}

        // Check for "loading"
        try {
          const loading = await browser.$('//*[contains(@text, "loading") or contains(@text, "Loading")]');
          if (await loading.isExisting()) {
            const txt = await loading.getText();
            console.log('Still loading:', txt);
          }
        } catch (e) {}

        await browser.pause(3000);
      }

      if (!success && !failureReason) {
        failureReason = 'Timed out waiting for model load result';
      }
    } else {
      // Button not found — screenshot for debugging
      await browser.saveScreenshot(path.join(__dirname, 'screenshot-02-no-button.png'));
      failureReason = 'Enable AI button not found';
      console.log('Enable AI button not found');

      // Dump page source for debugging
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
