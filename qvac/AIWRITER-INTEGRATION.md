# AI Writer Integration Guide

## Overview

This guide explains how the QVAC-Pear Miner Node integrates with the **AI Writer** application for collaborative, LLM-powered content generation.

## What is AI Writer?

AI Writer is a distributed wiki-generation and content-creation application:
- **Purpose**: Generate wiki pages, documentation, and creative writing via local LLM inference
- **Technology**: On-device AI using QVAC SDK (Llama models, speech-to-text, translation)
- **Rewards**: Contributors earn for high-quality generated content
- **Platform**: Web PWA + mobile companion, works across all supported devices
- **QVAC Integration**: Uses QVAC Inference Layer for local LLM routing and generation

## Integration Architecture

### Resource Allocation

```
Active Writing (User Input)     Idle / Background (Mining)
┌─────────────────┐          ┌─────────────────┐
│  AI Writer App  │          │  Multi-Protocol │
│  - Prompt Entry │          │  Mining         │
│  - LLM Gen      │          │  - Cortensor    │
│  - Wiki Save    │          │  - Chutes       │
│  - Peer Sync    │          │  - Fortytwo     │
│                 │          │  - Earnidle     │
│                 │          │  - Routstr      │
└─────────────────┘          └─────────────────┘
        │                            │
        └──────────┬─────────────────┘
                   │
            ┌──────▼──────┐
            │   Node       │
            │   Manager    │
            └──────┬──────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
    ┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
    │Cortensor│ │Chutes │ │Fortytwo│ │Earnidle│ │Routstr │
    │Monitor  │ │Monitor│ │Monitor │ │Monitor │ │Monitor │
    └─────────┘ └───────┘ └────────┘ └───────┘ └────────┘
```

### Parallel Miner Monitoring

All five miners run simultaneously in monitoring mode:

1. **CortensorMiner**: Monitors for AI network tasks
2. **ChutesMiner**: Monitors for GPU compute tasks
3. **FortytwoMiner**: Monitors for decentralized AI inference
4. **EarnidleMiner**: Monitors for idle compute opportunities
5. **RoutstrMiner**: Monitors for Nostr protocol tasks

When a writing task arrives:
- TaskMonitor immediately notifies all miners
- Miners can pause or adjust resource allocation
- AI Writer takes priority during active sessions
- Mining resumes when the user is idle

## Configuration

### Enable Parallel Monitoring

Edit `config.json`:

```json
{
  "miners": {
    "enabled": true,
    "parallelMode": true,
    "priority": ["cortensor", "chutes", "fortytwo", "earnidle", "routstr"]
  },
  "inference": {
    "enabled": true,
    "models": ["llama-2-7b", "llama-2-13b"],
    "maxConcurrent": 4,
    "idleTimeout": 300000
  }
}
```

## Usage

### Basic Integration

```javascript
import { AIWriterIntegration } from './examples/aiwriter-integration.js';
import { NodeManager } from './src/core/NodeManager.js';

// Initialize node
const nodeManager = new NodeManager(config);
await nodeManager.initialize();
await nodeManager.start();

// Initialize AI Writer integration
const aiWriter = new AIWriterIntegration(nodeManager);
await aiWriter.initialize();

// Check status
console.log(aiWriter.getStatus());
```

### Generate Content

```javascript
// Submit a writing prompt during an active session
if (aiWriter.isSessionActive) {
  const result = await aiWriter.generate({
    prompt: 'Explain decentralized AI inference',
    title: 'Decentralized AI',
    model: 'llama-2-7b'
  });
  console.log(`Generated ${result.wordCount} words`);
}
```

### Monitor Inference Tasks

```javascript
// Task monitor automatically detects inference tasks
// Miners are notified immediately
// No manual polling required
```

## Benefits

### For Users
- **Dual Earning**: Earn from content contributions and mining when idle
- **No Conflicts**: Automatic resource allocation prevents app conflicts
- **Passive Income**: Miners run automatically in the background
- **Local AI**: All generation happens on-device for privacy

### For the Network
- **Increased Participation**: More nodes available during peak hours
- **Better Resource Utilization**: Devices contribute when not in use
- **Reliable Inference**: Parallel monitoring ensures immediate response
- **Scalable Architecture**: Easy to add more apps and miners

## Technical Details

### Session Management

The AI Writer tracks user activity:
- Active session: User is typing or generating content
- Idle session: No input for 5 minutes (configurable)
- Mining resumes automatically when idle

### Task Detection

The TaskMonitor provides:
- Real-time inference task registration
- Immediate notification to all miners
- Task status tracking
- Automatic cleanup of completed tasks

### Miner Behavior

In parallel monitoring mode:
- All miners run simultaneously
- Low resource consumption (monitoring state)
- Immediate response to inference tasks
- Can pause/adjust based on user activity

## Troubleshooting

### AI Writer Not Responding

Check inference layer status:
```javascript
const status = nodeManager.getStatus();
console.log(status.inference);
```

### Miners Not Monitoring

Ensure parallel mode is enabled:
```json
{
  "miners": {
    "parallelMode": true
  }
}
```

### Inference Tasks Not Detected

Check task monitor status:
```javascript
const status = nodeManager.getStatus();
console.log(status.tasks);
```

## Example Scenarios

### Scenario 1: Active Writing Session

1. User opens AI Writer PWA
2. Enters prompt: "Explain quantum computing"
3. Node routes request to local LLM
4. All miners continue monitoring in background
5. Content generated and saved to distributed wiki
6. User earns contribution rewards

### Scenario 2: Background Mining

1. User closes AI Writer tab
2. Session idle timer starts (5 minutes)
3. After idle timeout, miners resume full operation
4. Device earns from multiple mining protocols
5. Next writing session pauses miners automatically

### Scenario 3: Parallel Task Handling

1. AI Writer generating a long article
2. Inference task arrives from external app
3. TaskMonitor notifies all miners
4. Miners pause/adjust resources
5. Inference task completed
6. Miners resume monitoring

## Future Enhancements

- [ ] Collaborative editing across peer nodes
- [ ] Auto-save drafts to Hypercore
- [ ] Voice-to-text integration for mobile
- [ ] Real-time word-count and earning dashboard
- [ ] Template library for common document types
- [ ] Multi-language generation support
- [ ] Automatic reward claiming for contributions

## Resources

- [QVAC Documentation](https://github.com/tetherto/qvac)
- [Pear Runtime](https://docs.pears.com/)
- [Hypercore](https://github.com/holepunchto/hypercore)

## Support

For issues or questions:
- GitHub Issues: [Create an issue](https://github.com/TerexitariusStomp/localchimera/issues)
- Documentation: See `/docs` directory
- Examples: See `/examples` directory
