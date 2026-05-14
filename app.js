const startStopBtn = document.getElementById('startStopBtn');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const languageSelect = document.getElementById('languageSelect');

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
  statusEl.textContent = 'Speech Recognition API not supported in this browser.';
  startStopBtn.disabled = true;
} else {
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = languageSelect.value;

  let isListening = false;
  let savedTranscript = '';

  const updateButton = () => {
    startStopBtn.textContent = isListening ? 'Stop Listening' : 'Start Listening';
  };

  recognition.addEventListener('result', (event) => {
    let finalTranscript = savedTranscript;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      finalTranscript += result[0].transcript;
    }
    transcriptEl.value = finalTranscript.trim();
  });

  recognition.addEventListener('start', () => {
    isListening = true;
    statusEl.textContent = 'Listening... Speak now.';
    updateButton();
  });

  recognition.addEventListener('end', () => {
    if (isListening) {
      recognition.start();
    } else {
      statusEl.textContent = 'Paused. Click Start to begin.';
      updateButton();
      savedTranscript = transcriptEl.value.trim() ? transcriptEl.value.trim() + '\n' : '';
    }
  });

  recognition.addEventListener('error', (event) => {
    statusEl.textContent = `Error: ${event.error}`;
    isListening = false;
    updateButton();
  });

  startStopBtn.addEventListener('click', () => {
    if (isListening) {
      isListening = false;
      recognition.stop();
    } else {
      recognition.lang = languageSelect.value;
      transcriptEl.value = transcriptEl.value.trim();
      recognition.start();
    }
    updateButton();
  });
}

const ragaBtn = document.getElementById('ragaBtn');
const ragaStatus = document.getElementById('ragaStatus');
const ragaOutput = document.getElementById('ragaOutput');
const tonicBtn = document.getElementById('tonicBtn');
const tonicInfo = document.getElementById('tonicInfo');

let audioContext = null;
let analyser = null;
let mediaStream = null;
let animationId = null;
let noteHistory = [];
let tonicHistory = [];
let tonicFrequency = null;
let isTraining = false;

function frequencyToMidi(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

function midiToNoteName(midi) {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return noteNames[((Math.round(midi) % 12) + 12) % 12];
}

function semitoneDistance(referenceFrequency, frequency) {
  return Math.round(12 * Math.log2(frequency / referenceFrequency));
}

function relativePitchClass(frequency) {
  if (!tonicFrequency || frequency <= 0) {
    return ((Math.round(frequencyToMidi(frequency)) % 12) + 12) % 12;
  }
  return ((semitoneDistance(tonicFrequency, frequency) % 12) + 12) % 12;
}

function countNoteClasses(noteClasses) {
  const counts = new Array(12).fill(0);
  noteClasses.forEach((note) => {
    counts[note] += 1;
  });
  return counts;
}

function frequencyToMidi(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

function midiToNoteName(midi) {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return noteNames[((Math.round(midi) % 12) + 12) % 12];
}

function semitoneDistance(referenceFrequency, frequency) {
  return Math.round(12 * Math.log2(frequency / referenceFrequency));
}

function relativePitchClass(frequency, tonicFrequency) {
  if (!tonicFrequency || frequency <= 0) {
    return ((Math.round(frequencyToMidi(frequency)) % 12) + 12) % 12;
  }
  return ((semitoneDistance(tonicFrequency, frequency) % 12) + 12) % 12;
}

function pitchStability(frequencies) {
  if (frequencies.length < 30) return null;
  const avg = frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length;
  const maxDev = Math.max(...frequencies.map((value) => Math.abs(value - avg)));
  return { avg, maxDev };
}

function scaleNoteName(relativeClass) {
  const swaras = ['Sa', 'Ri1', 'Ri2', 'Ga1', 'Ga2', 'Ma1', 'Ma2', 'Pa', 'Da1', 'Da2', 'Ni1', 'Ni2'];
  return swaras[relativeClass] || 'Sa';
}

function autoCorrelate(buffer, sampleRate) {
  let size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) {
    const val = buffer[i];
    rms += val * val;
  }
  if (rms < 0.01) {
    return -1;
  }

  let bestOffset = -1;
  let bestCorrelation = 0;
  let correlations = new Array(size).fill(0);

  for (let offset = 16; offset < size; offset += 1) {
    let correlation = 0;
    for (let i = 0; i < size - offset; i += 1) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    correlation = 1 - correlation / (size - offset);
    correlations[offset] = correlation;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestCorrelation > 0.9) {
    return sampleRate / bestOffset;
  }
  return -1;
}

function inferRaga(noteClasses) {
  if (noteClasses.length === 0) {
    return { name: 'No raga detected', confidence: 0 };
  }

  // First check trained models
  const trainedResult = inferTrainedRaga(noteClasses);
  if (trainedResult && trainedResult.confidence > 50) {
    return { name: trainedResult.name, confidence: trainedResult.confidence };
  }

  const noteCounts = countNoteClasses(noteClasses);
  const totalNotes = noteClasses.length;

  const ragas = [
    { name: 'Shankarabharanam', intervals: [0, 2, 4, 5, 7, 9, 11] },
    { name: 'Kalyani', intervals: [0, 2, 4, 6, 7, 9, 11] },
    { name: 'Mohanam', intervals: [0, 2, 4, 7, 9] },
    { name: 'Kambhoji', intervals: [0, 2, 4, 5, 7, 9, 10] },
    { name: 'Todi', intervals: [0, 1, 3, 5, 6, 8, 10] },
    { name: 'Hindolam', intervals: [0, 3, 5, 8, 10] },
  ];

  let best = { name: 'Unknown', score: -Infinity, confidence: 0 };
  for (const raga of ragas) {
    for (let root = 0; root < 12; root += 1) {
      const pattern = raga.intervals.map((interval) => (interval + root) % 12);
      const patternSet = new Set(pattern);
      const matched = pattern.reduce((sum, note) => sum + noteCounts[note], 0);
      const extra = noteCounts.reduce((sum, count, note) => (patternSet.has(note) ? sum : sum + count), 0);
      const presentCount = pattern.filter((note) => noteCounts[note] > 0).length;
      const missing = pattern.length - presentCount;
      const score = matched - extra * 0.5 - missing * 1.2;
      const confidence = Math.max(
        0,
        Math.min(
          100,
          (matched / Math.max(totalNotes, 1)) * 100 - (extra / Math.max(totalNotes, 1)) * 40 - missing * 10,
        ),
      );
      if (score > best.score) {
        best = { name: `${raga.name} (${midiToNoteName(root)} tonic)`, score, confidence };
      }
    }
  }
  return best;
}

function updateRagaDisplay(frequency) {
  if (frequency < 0) {
    ragaStatus.textContent = 'Waiting for a strong pitched note...';
    return;
  }
  const midi = frequencyToMidi(frequency);
  const noteClass = relativePitchClass(frequency);
  noteHistory.push(noteClass);
  if (noteHistory.length > 120) {
    noteHistory.shift();
  }
  const raga = inferRaga(noteHistory);
  ragaStatus.textContent = `Detected note: ${scaleNoteName(noteClass)} (${frequency.toFixed(1)} Hz)`;
  ragaOutput.textContent = `Best match: ${raga.name} — confidence ${raga.confidence.toFixed(0)}%`;
}

function stopRagaDetection() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  analyser = null;
  noteHistory = [];
  ragaStatus.textContent = 'Raga detection stopped.';
  ragaBtn.textContent = 'Start Raga Detection';
}

async function startRagaDetection() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    ragaStatus.textContent = 'Microphone access is not available in this browser.';
    return;
  }

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    noteHistory = [];
    tonicHistory = [];
    if (isTraining) {
      ragaStatus.textContent = 'Training tonic... sing a clear Sa note.';
      ragaOutput.textContent = 'Hold Sa steadily for a few seconds.';
    } else {
      ragaStatus.textContent = 'Listening for ragas... sing now.';
      ragaOutput.textContent = 'Detected raga will appear here after you sing.';
    }
    ragaBtn.textContent = 'Stop Raga Detection';
    detectRagaLoop();
  } catch (error) {
    ragaStatus.textContent = `Microphone permission denied or unavailable: ${error.message}`;
  }
}

function detectRagaLoop() {
  if (!analyser) {
    return;
  }
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);
  const frequency = autoCorrelate(buffer, audioContext.sampleRate);
  if (isTraining) {
    if (frequency > 0) {
      tonicHistory.push(frequency);
      if (tonicHistory.length > 80) {
        tonicHistory.shift();
      }
      const stability = pitchStability(tonicHistory);
      if (stability && stability.maxDev < 2.0) {
        tonicFrequency = stability.avg;
        tonicInfo.textContent = `Tonic set: ${tonicFrequency.toFixed(1)} Hz`;
        ragaStatus.textContent = 'Tonic trained. Now use Raga Detection.';
        ragaOutput.textContent = `Tonic frequency is ${tonicFrequency.toFixed(1)} Hz.`;
        isTraining = false;
        stopRagaDetection();
        return;
      }
      ragaStatus.textContent = `Training tonic... ${tonicHistory.length} samples collected.`;
    } else {
      ragaStatus.textContent = 'Training tonic... waiting for a strong note.';
    }
  } else {
    updateRagaDisplay(frequency);
  }
  animationId = requestAnimationFrame(detectRagaLoop);
}

ragaBtn.addEventListener('click', () => {
  if (animationId) {
    stopRagaDetection();
  } else {
    startRagaDetection();
  }
});

tonicBtn.addEventListener('click', () => {
  if (animationId) {
    stopRagaDetection();
  }
  isTraining = !isTraining;
  tonicInfo.textContent = isTraining ? 'Training active: sing your tonic Sa now.' : (tonicFrequency ? `Tonic set: ${tonicFrequency.toFixed(1)} Hz` : 'Tonic not set');
  if (isTraining) {
    startRagaDetection();
  }
});

// Model training with file uploads
let trainedModels = (() => {
  try {
    return JSON.parse(localStorage.getItem('carnatic-trained-models') || '{}');
  } catch (error) {
    return {};
  }
})();

const trainingRagaSelect = document.getElementById('trainingRagaSelect');
const audioFileInput = document.getElementById('audioFileInput');
const processTrainBtn = document.getElementById('processTrainBtn');
const resetModelBtn = document.getElementById('resetModelBtn');
const trainingStatus = document.getElementById('trainingStatus');
const trainedRagas = document.getElementById('trainedRagas');

const extractFeatures = (noteClasses) => {
  const noteCounts = countNoteClasses(noteClasses);
  const totalNotes = noteClasses.length;
  const normalized = noteCounts.map((count) => count / totalNotes);
  const bigrams = {};
  for (let i = 0; i < noteClasses.length - 1; i += 1) {
    const bigram = `${noteClasses[i]}-${noteClasses[i + 1]}`;
    bigrams[bigram] = (bigrams[bigram] || 0) + 1;
  }
  const normalizedBigrams = Object.fromEntries(
    Object.entries(bigrams).map(([k, v]) => [k, v / Math.max(1, noteClasses.length - 1)]),
  );
  return { normalized, normalizedBigrams, noteCount: totalNotes };
};

const saveTrainedModel = (ragaName, noteClasses) => {
  if (!noteClasses.length) return;
  const features = extractFeatures(noteClasses);
  const existing = trainedModels[ragaName]?.samples || [];
  trainedModels[ragaName] = {
    samples: [...existing, features],
    sampleCount: existing.length + 1,
  };
  try {
    localStorage.setItem('carnatic-trained-models', JSON.stringify(trainedModels));
  } catch (error) {
    // ignore storage errors
  }
  updateTrainedRagasDisplay();
};

const euclideanDistance = (a, b) => {
  let sum = 0;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i += 1) {
    sum += ((a[i] || 0) - (b[i] || 0)) ** 2;
  }
  return Math.sqrt(sum);
};

const inferTrainedRaga = (noteClasses) => {
  if (!noteClasses.length || Object.keys(trainedModels).length === 0) {
    return null;
  }
  const queryFeatures = extractFeatures(noteClasses);
  const k = 3;
  let best = { name: 'Unknown', score: -Infinity, confidence: 0 };
  for (const [ragaName, model] of Object.entries(trainedModels)) {
    if (!model.samples || !model.samples.length) continue;
    const distances = model.samples.map((sample) => {
      const noteDist = euclideanDistance(queryFeatures.normalized, sample.normalized);
      const bigramDist = euclideanDistance(
        Object.values(queryFeatures.normalizedBigrams),
        Object.values(sample.normalizedBigrams),
      );
      return noteDist * 0.6 + bigramDist * 0.4;
    });
    distances.sort((a, b) => a - b);
    const kNearestScore =
      distances.slice(0, Math.min(k, distances.length)).reduce((s, d) => s + 1 / (1 + d), 0) / k;
    const confidence = Math.max(0, Math.min(100, kNearestScore * 100));
    if (kNearestScore > best.score) {
      best = { name: `${ragaName} (trained)`, score: kNearestScore, confidence };
    }
  }
  return best.score > 0 ? best : null;
};

const processAudioFile = async (file) => {
  console.log('Processing file:', file.name, 'Type:', file.type, 'Size:', file.size);

  trainingStatus.textContent = 'Processing audio file...';

  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log('AudioContext created, sample rate:', audioContext.sampleRate);

    const arrayBuffer = await file.arrayBuffer();
    console.log('ArrayBuffer loaded, size:', arrayBuffer.byteLength);

    // Check if the buffer has data
    if (arrayBuffer.byteLength === 0) {
      trainingStatus.textContent = 'File appears to be empty or corrupted.';
      return null;
    }

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    console.log('AudioBuffer decoded successfully, duration:', audioBuffer.duration, 'channels:', audioBuffer.numberOfChannels);

    // Check if audio buffer is valid
    if (audioBuffer.duration === 0 || audioBuffer.length === 0) {
      trainingStatus.textContent = 'Audio file appears to be empty or invalid.';
      audioContext.close();
      return null;
    }

    if (audioBuffer.duration < 1) {
      trainingStatus.textContent = 'Audio file is too short. Please use recordings longer than 1 second.';
      audioContext.close();
      return null;
    }

    // Check if audio buffer is valid
    if (audioBuffer.duration === 0 || audioBuffer.length === 0) {
      trainingStatus.textContent = 'Audio file appears to be empty or invalid.';
      audioContext.close();
      return null;
    }

    if (audioBuffer.duration < 1) {
      trainingStatus.textContent = 'Audio file is too short. Please use recordings longer than 1 second.';
      audioContext.close();
      return null;
    }

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);

    const noteClasses = [];
    const sampleRate = audioContext.sampleRate;
    const duration = audioBuffer.duration;
    const stepSize = 0.1; // Process every 100ms
    const totalSteps = Math.floor(duration / stepSize);

    for (let i = 0; i < totalSteps; i += 1) {
      const startTime = i * stepSize;
      const endTime = Math.min((i + 1) * stepSize, duration);

      // Get audio data for this time slice
      const frameCount = Math.floor((endTime - startTime) * sampleRate);
      const buffer = new Float32Array(analyser.fftSize);

      // Simple approach: process the entire buffer at once
      const channelData = audioBuffer.getChannelData(0);
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor(endTime * sampleRate);

      for (let j = 0; j < analyser.fftSize && startSample + j < endSample; j += 1) {
        buffer[j] = channelData[startSample + j] || 0;
      }

      const frequency = autoCorrelate(buffer, sampleRate);
      if (frequency > 80 && frequency < 2000) { // Filter reasonable vocal range
        const noteClass = relativePitchClass(frequency, tonicFrequency);
        noteClasses.push(noteClass);
      }
    }

    audioContext.close();

    if (noteClasses.length < 20) {
      trainingStatus.textContent = 'Not enough notes detected in the file. Try a longer or clearer recording.';
      return null;
    }

    trainingStatus.textContent = `Extracted ${noteClasses.length} notes from file.`;
    return noteClasses;

  } catch (error) {
    console.error('Audio processing error:', error);
    let errorMessage = 'Error processing file: ';

    if (error.name === 'EncodingError' || error.message.includes('decode')) {
      errorMessage += 'Unable to decode audio data. The file may be corrupted, in an unsupported format, or not a valid audio file. Please try a different audio file (MP3, WAV, MP4, or M4A).';
    } else if (error.message.includes('network')) {
      errorMessage += 'Network error while loading file.';
    } else if (error.message.includes('abort')) {
      errorMessage += 'File loading was aborted.';
    } else {
      errorMessage += error.message;
    }

    trainingStatus.textContent = errorMessage;
    return null;
  }
};

const updateTrainedRagasDisplay = () => {
  const ragas = Object.keys(trainedModels);
  trainedRagas.textContent = ragas.length ? `Trained ragas: ${ragas.join(', ')}` : 'Trained ragas: None';
};

const validateAudioFile = (file) => {
  console.log('Validating file:', file.name, 'MIME type:', file.type, 'Size:', file.size);

  // Check file type
  const supportedTypes = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'video/mp4'];
  const isSupported = supportedTypes.some(type => file.type === type) || file.type.startsWith('audio/');

  console.log('Supported types check:', isSupported, 'for type:', file.type);

  if (!isSupported) {
    return `Unsupported file type: ${file.type}. Please use MP3, WAV, MP4, or M4A files.`;
  }

  // Check file size (max 50MB)
  if (file.size > 50 * 1024 * 1024) {
    return 'File too large. Please use files smaller than 50MB.';
  }

  // Check minimum file size (1KB)
  if (file.size < 1024) {
    return 'File too small. Please use valid audio files.';
  }

  return null; // File is valid
};

const handleFileUpload = async () => {
  const file = audioFileInput.files[0];
  if (!file) {
    trainingStatus.textContent = 'Please select an audio file first.';
    return;
  }

  // Validate file before processing
  const validationError = validateAudioFile(file);
  if (validationError) {
    trainingStatus.textContent = validationError;
    return;
  }

  const noteClasses = await processAudioFile(file);
  if (noteClasses) {
    const selectedRaga = trainingRagaSelect.value;
    saveTrainedModel(selectedRaga, noteClasses);
    trainingStatus.textContent = `Successfully trained model with "${file.name}" for ${selectedRaga}.`;
    audioFileInput.value = ''; // Clear the file input
  }
};

processTrainBtn.addEventListener('click', handleFileUpload);

resetModelBtn.addEventListener('click', () => {
  trainedModels = {};
  localStorage.removeItem('carnatic-trained-models');
  trainingStatus.textContent = 'Trained model cleared.';
  updateTrainedRagasDisplay();
});

// Initialize display
updateTrainedRagasDisplay();
