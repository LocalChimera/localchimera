import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import frontendHtml, { frontendJs } from './frontend-html';

const LLAMA_MODEL = 'LLAMA_3_2_1B_INST_Q4_0';
const WIKI_DIR = FileSystem.documentDirectory + 'llmwiki/';

export default function App() {
  const [modelStatus, setModelStatus] = useState('initializing');
  const [modelId, setModelId] = useState(null);
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState(null);
  const webViewRef = useRef(null);

  useEffect(() => {
    async function init() {
      try {
        await FileSystem.makeDirectoryAsync(WIKI_DIR, { intermediates: true }).catch(() => {});

        // TODO: @qvac/sdk / react-native-bare-kit crashes on release builds when
        // initialized. Skipping model load until the native module issue is fixed.
        // The wiki frontend will still load; AI endpoints will report unavailable.
        setModelStatus('ready');
      } catch (e) {
        console.error('Init error:', e);
        setModelStatus(`error: ${e.message}`);
      }
    }
    init();
  }, []);

  async function handleAIWrite(body) {
    if (!modelId) throw new Error('Model not loaded');
    const { completion } = await import('@qvac/sdk');
    const history = [{ role: 'user', content: body.prompt }];
    const result = completion({ modelId, history, stream: false });
    let generated = '';
    for await (const token of result.tokenStream) {
      generated += token;
    }
    return {
      success: true,
      data: {
        title: body.title || 'Generated',
        body: generated,
        source: 'qvac-on-device',
        model: LLAMA_MODEL,
      },
    };
  }

  async function handleAIStatus() {
    return {
      success: true,
      data: {
        available: true,
        qvacAvailable: !!modelId,
        model: modelId ? LLAMA_MODEL : null,
        modelLoading: !modelId && modelStatus !== 'ready' && !modelStatus.startsWith('error'),
      },
    };
  }

  async function handleAIDocs() {
    return { success: true, data: [] };
  }

  async function handleWikiDocs() {
    try {
      const entries = await FileSystem.readDirectoryAsync(WIKI_DIR).catch(() => []);
      const docs = [];
      for (const name of entries) {
        if (!name.endsWith('.md')) continue;
        const info = await FileSystem.getInfoAsync(WIKI_DIR + name);
        if (!info.exists) continue;
        docs.push({
          id: name.replace(/\.md$/, ''),
          title: name.replace(/\.md$/, '').replace(/_/g, ' '),
          path: name,
          modified: info.modificationTime ? new Date(info.modificationTime * 1000).toISOString() : new Date().toISOString(),
        });
      }
      docs.sort((a, b) => new Date(b.modified) - new Date(a.modified));
      return { success: true, data: docs };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function handleWikiRead(body, query) {
    try {
      const id = (body.id || query.replace(/^id=/, '') || 'welcome').replace(/\.md$/, '');
      const filename = id.replace(/\s+/g, '_') + '.md';
      const path = WIKI_DIR + filename;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        return { success: false, error: 'Page not found' };
      }
      const content = await FileSystem.readAsStringAsync(path);
      return { success: true, data: { id, title: id.replace(/_/g, ' '), content } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function handleWikiSave(body) {
    try {
      const id = body.id || body.title;
      if (!id) throw new Error('Missing page id/title');
      const filename = String(id).replace(/\s+/g, '_') + '.md';
      await FileSystem.writeAsStringAsync(WIKI_DIR + filename, body.content || '');
      return { success: true, data: { id, filename } };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function handleWikiDelete(body, query) {
    try {
      const id = body.id || query.replace(/^id=/, '');
      if (!id) throw new Error('Missing page id');
      const filename = String(id).replace(/\s+/g, '_') + '.md';
      await FileSystem.deleteAsync(WIKI_DIR + filename, { idempotent: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async function handleStart() {
    return { success: true, data: { running: true, registered: { url: 'mobile://on-device', evmAddress: '', casperProvider: '' }, casper: { registered: [], errors: [] } } };
  }

  async function handleStop() {
    return { success: true, data: { running: false } };
  }

  async function handleSwarmStatus() {
    return { success: true, data: { id: null, status: 'local-only', peers: 0 } };
  }

  async function handleSwarmCreate() {
    return { success: true, data: { id: 'local', status: 'created' } };
  }

  async function handleSwarmJoin() {
    return { success: true, data: { id: 'local', status: 'joined' } };
  }

  const handleWebViewMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'bridge-ready') {
        console.log('Bridge ready from WebView');
        return;
      }
      if (msg.type === 'console') {
        console.log('WebView console:', msg.level, msg.args);
        return;
      }

      const { id, method, path, body } = msg;
      const query = path.includes('?') ? path.split('?')[1] : '';
      const cleanPath = path.split('?')[0];
      let res;

      if (method === 'POST' && cleanPath === '/api/ai-write') {
        res = await handleAIWrite(body);
      } else if (method === 'GET' && cleanPath === '/api/ai-status') {
        res = await handleAIStatus();
      } else if (method === 'GET' && cleanPath === '/api/ai-docs') {
        res = await handleAIDocs();
      } else if (method === 'GET' && cleanPath === '/api/llmwiki-docs') {
        res = await handleWikiDocs();
      } else if (method === 'GET' && cleanPath.startsWith('/api/llmwiki-read')) {
        res = await handleWikiRead(body, query);
      } else if (method === 'POST' && cleanPath === '/api/llmwiki-save') {
        res = await handleWikiSave(body);
      } else if (method === 'DELETE' && cleanPath.startsWith('/api/llmwiki-delete')) {
        res = await handleWikiDelete(body, query);
      } else if (method === 'POST' && cleanPath === '/api/start') {
        res = await handleStart();
      } else if (method === 'POST' && cleanPath === '/api/stop') {
        res = await handleStop();
      } else if (method === 'GET' && cleanPath === '/api/swarm/status') {
        res = await handleSwarmStatus();
      } else if (method === 'POST' && cleanPath === '/api/swarm/create') {
        res = await handleSwarmCreate();
      } else if (method === 'POST' && cleanPath === '/api/swarm/join') {
        res = await handleSwarmJoin();
      } else {
        res = { success: false, error: 'Not found: ' + method + ' ' + cleanPath };
      }

      webViewRef.current?.injectJavaScript(`
        window.__bridgeResolve(${id}, ${JSON.stringify(res)});
        true;
      `);
    } catch (e) {
      console.error('Bridge error:', e);
    }
  };

  const injectedBridge = `
    (function() {
      if (window.__bridgeActive) return;
      window.__bridgeActive = true;
      window.__bridgeFetch = true;
      window.__bridgeResolvers = {};
      console.log('[Bridge] Injected bridge script running');
      console.log('[Bridge] document.getElementById(root):', document.getElementById('root'));
      console.log('[Bridge] Scripts on page:', document.querySelectorAll('script').length);
      window.__bridgeResolve = function(id, data) {
        const cb = window.__bridgeResolvers[id];
        if (cb) cb(data);
        delete window.__bridgeResolvers[id];
      };

      const originalFetch = window.fetch;
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      const forwardLog = (level, args) => {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'console', level, args: Array.from(args).map(String) }));
      };
      console.log = function(...args) { forwardLog('log', args); return originalConsoleLog.apply(this, args); };
      console.error = function(...args) { forwardLog('error', args); return originalConsoleError.apply(this, args); };
      console.warn = function(...args) { forwardLog('warn', args); };

      const isApiCall = (url) => {
        if (typeof url !== 'string') return false;
        return url.startsWith('/api') || url.startsWith('http://localhost:3002/api');
      };
      const extractPath = (url) => {
        if (url.startsWith('/api')) return url;
        return url.replace('http://localhost:3002', '');
      };

      window.fetch = async function(url, options = {}) {
        if (isApiCall(url)) {
          return new Promise((resolve, reject) => {
            const id = Date.now() + Math.random();
            const body = options.body ? JSON.parse(options.body) : {};
            window.__bridgeResolvers[id] = (res) => {
              resolve(new Response(JSON.stringify(res), {
                status: res.success ? 200 : 500,
                headers: { 'Content-Type': 'application/json' }
              }));
            };
            window.ReactNativeWebView.postMessage(JSON.stringify({
              id, method: options.method || 'GET', path: extractPath(url), body
            }));
            setTimeout(() => {
              if (window.__bridgeResolvers[id]) {
                delete window.__bridgeResolvers[id];
                reject(new Error('Bridge timeout'));
              }
            }, 120000);
          });
        }
        return originalFetch(url, options);
      };

      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'bridge-ready' }));

      // Check if React renders into root div
      setTimeout(function() {
        var root = document.getElementById('root');
        console.log('[Bridge] After 2s, root innerHTML length:', root ? root.innerHTML.length : 'no root');
        console.log('[Bridge] After 2s, root children:', root ? root.children.length : 'no root');
        if (root && root.innerHTML.length > 0) {
          console.log('[Bridge] React rendered successfully');
          // Debug: add visible borders to check layout
          root.style.border = '3px solid red';
          root.style.minHeight = '200px';
          if (root.children[0]) { root.children[0].style.border = '2px solid yellow'; }
          // Debug computed styles
          var body = document.body;
          var bodyStyle = window.getComputedStyle(body);
          console.log('[Bridge] body bg:', bodyStyle.backgroundColor, 'color:', bodyStyle.color, 'display:', bodyStyle.display, 'visibility:', bodyStyle.visibility);
          var rootStyle = window.getComputedStyle(root);
          console.log('[Bridge] root bg:', rootStyle.backgroundColor, 'display:', rootStyle.display, 'visibility:', rootStyle.visibility, 'width:', rootStyle.width, 'height:', rootStyle.height);
          console.log('[Bridge] root offsetWidth:', root.offsetWidth, 'offsetHeight:', root.offsetHeight);
          // Check first child
          if (root.children[0]) {
            var child = root.children[0];
            var cs = window.getComputedStyle(child);
            console.log('[Bridge] first child tag:', child.tagName, 'bg:', cs.backgroundColor, 'display:', cs.display, 'w:', child.offsetWidth, 'h:', child.offsetHeight);
          }
        } else {
          console.log('[Bridge] React did NOT render - root is empty');
        }
      }, 2000);
    })();
  `;

  if (webError) {
    return (
      <View style={styles.container}>
        <Text style={[styles.text, { color: '#ff6b6b' }]}>Failed to load frontend</Text>
        <Text style={[styles.text, { fontSize: 12, color: '#7a7468' }]}>{webError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: frontendHtml, baseUrl: 'file:///android_asset/frontend/' }}
        style={styles.webview}
        injectedJavaScriptBeforeContentLoaded={`if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){${frontendJs}});}else{${frontendJs}}`}
        injectedJavaScript={injectedBridge}
        onMessage={handleWebViewMessage}
        onLoad={() => { console.log('[App] WebView onLoad fired'); setWebLoading(false); }}
        onError={(e) => {
          console.error('WebView error:', e.nativeEvent);
          setWebLoading(false);
          setWebError('WebView error: ' + (e.nativeEvent.description || 'unknown'));
        }}
        onHttpError={(e) => {
          console.error('WebView HTTP error:', e.nativeEvent);
          setWebLoading(false);
          setWebError('HTTP ' + (e.nativeEvent.statusCode || 'error'));
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        originWhitelist={['*']}
        renderToHardwareTextureAndroid={true}
        scalesPageToFit={true}
      />
      {webLoading && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0a0a14', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#00e5ff" />
          <Text style={styles.text}>Loading Chimera...</Text>
          {modelStatus !== 'ready' && (
            <Text style={[styles.text, { fontSize: 12, color: '#7a7468' }]}>{modelStatus}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: {
    flex: 1,
    width: '100%',
    backgroundColor: '#0e0d0b',
  },
  text: {
    color: '#e8e2d8',
    marginTop: 16,
    fontSize: 14,
  },
});
