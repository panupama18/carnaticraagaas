import { useEffect, useRef, useState } from 'react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const supportedRagas = [
  { name: 'Shankarabharanam', intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Kalyani', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Mohanam', intervals: [0, 2, 4, 7, 9] },
  { name: 'Kambhoji', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Todi', intervals: [0, 1, 3, 5, 6, 8, 10] },
  { name: 'Hindolam', intervals: [0, 3, 5, 8, 10] },
];

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

function countNoteClasses(noteClasses) {
  const counts = new Array(12).fill(0);
  noteClasses.forEach((note) => {
    counts[note] += 1;
  });
  return counts;
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
  if (rms < 0.01) return -1;

  let bestCorrelation = 0;
  let bestOffset = -1;

  for (let offset = 16; offset < size; offset += 1) {
    let correlation = 0;
    for (let i = 0; i < size - offset; i += 1) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    correlation = 1 - correlation / (size - offset);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }
  return bestCorrelation > 0.9 ? sampleRate / bestOffset : -1;
}

function inferRaga(noteClasses) {
  if (noteClasses.length === 0) {
    return { name: 'No raga detected', confidence: 0 };
  }

  const noteCounts = countNoteClasses(noteClasses);
  const totalNotes = noteClasses.length;

  let best = { name: 'Unknown', score: -Infinity, confidence: 0 };
  for (const raga of supportedRagas) {
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
        best = {
          name: `${raga.name} (${midiToNoteName(root)} tonic)`,
          score,
          confidence,
        };
      }
    }
  }
  return best;
}

export default function App() {
  const recognitionRef = useRef(null);
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Ready');
  const [isListening, setIsListening] = useState(false);
  const [language, setLanguage] = useState('te-IN');
  const [supported, setSupported] = useState(true);
  const [ragaStatus, setRagaStatus] = useState('Ready to detect ragas.');
  const [ragaText, setRagaText] = useState('Detected raga will appear here after you sing.');
  const [isRagaListening, setIsRagaListening] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [tonicFrequency, setTonicFrequency] = useState(null);
  const [selectedTrainingRaga, setSelectedTrainingRaga] = useState(supportedRagas[0].name);
  const [isModelTraining, setIsModelTraining] = useState(false);
  const [modelTrainingStatus, setModelTrainingStatus] = useState('Ready to train model.');
  const [trainedModels, setTrainedModels] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('carnatic-trained-models') || '{}');
    } catch (error) {
      return {};
    }
  });
  const trainingRef = useRef(false);
  const tonicHistoryRef = useRef([]);
  const modelTrainingRef = useRef(false);
  const modelTrainingLabelRef = useRef(null);
  const modelTrainingHistoryRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const noteHistoryRef = useRef([]);

  useEffect(() => {
    if (!SpeechRecognition) {
      setSupported(false);
      setStatus('Speech Recognition API not supported. Use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.addEventListener('result', (event) => {
      setTranscript((prevTranscript) => {
        let finalText = prevTranscript;
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          finalText += event.results[i][0].transcript;
        }
        return finalText.trim();
      });
    });

    recognition.addEventListener('start', () => {
      setStatus('Listening...');
      setIsListening(true);
    });

    recognition.addEventListener('end', () => {
      if (isListening) {
        recognition.start();
      } else {
        setStatus('Paused. Click Start to listen again.');
      }
    });

    recognition.addEventListener('error', (event) => {
      setStatus(`Error: ${event.error}`);
      setIsListening(false);
    });

    recognitionRef.current = recognition;

    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, [language]);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.lang = language;
      recognitionRef.current.start();
      setStatus('Initializing microphone...');
    }
  };

  const stopRagaDetection = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    noteHistoryRef.current = [];
    setIsRagaListening(false);
    setIsTraining(false);
    trainingRef.current = false;
    modelTrainingRef.current = false;
    modelTrainingLabelRef.current = null;
    setRagaStatus('Raga detection stopped.');
    setRagaText('Detected raga will appear here after you sing.');
  };

  const saveTrainedModel = (ragaName, noteClasses) => {
    if (!noteClasses.length) return;
    const counts = countNoteClasses(noteClasses);
    const totalNotes = noteClasses.length;
    const normalized = counts.map((count) => count / totalNotes);
    setTrainedModels((previous) => {
      const existing = previous[ragaName];
      const combinedTotal = existing ? existing.totalNotes + totalNotes : totalNotes;
      const combinedCounts = counts.map((count, index) => (existing ? existing.noteCounts[index] + count : count));
      const combinedNormalized = combinedCounts.map((count) => count / combinedTotal);
      const next = {
        ...previous,
        [ragaName]: {
          noteCounts: combinedCounts,
          totalNotes: combinedTotal,
          sampleCount: existing ? existing.sampleCount + 1 : 1,
          normalized: combinedNormalized,
        },
      };
      try {
        localStorage.setItem('carnatic-trained-models', JSON.stringify(next));
      } catch (error) {
        // ignore storage errors
      }
      return next;
    });
  };

  const clearTrainedModels = () => {
    setTrainedModels({});
    localStorage.removeItem('carnatic-trained-models');
    setModelTrainingStatus('Trained model cleared.');
  };

  const inferTrainedRaga = (noteClasses) => {
    if (!noteClasses.length || Object.keys(trainedModels).length === 0) {
      return null;
    }
    const noteCounts = countNoteClasses(noteClasses);
    const totalNotes = noteClasses.length;
    const normalized = noteCounts.map((count) => count / totalNotes);
    let best = { name: 'Unknown', score: -Infinity, confidence: 0 };
    for (const [ragaName, model] of Object.entries(trainedModels)) {
      const similarity = normalized.reduce(
        (sum, value, index) => sum + Math.min(value, model.normalized[index]),
        0,
      );
      const extra = noteCounts.reduce(
        (sum, count, index) => (model.normalized[index] === 0 ? sum + count : sum),
        0,
      );
      const score = similarity - extra * 0.2;
      const confidence = Math.max(0, Math.min(100, score * 120));
      if (score > best.score) {
        best = { name: `${ragaName} (trained)`, score, confidence };
      }
    }
    return best;
  };

  const detectRagaLoop = () => {
    const analyser = analyserRef.current;
    const audioContext = audioContextRef.current;
    if (!analyser || !audioContext) {
      return;
    }
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    const frequency = autoCorrelate(buffer, audioContext.sampleRate);
    if (frequency > 0) {
      if (trainingRef.current) {
        tonicHistoryRef.current.push(frequency);
        if (tonicHistoryRef.current.length > 80) {
          tonicHistoryRef.current.shift();
        }
        const stability = pitchStability(tonicHistoryRef.current);
        if (stability && stability.maxDev < 2.0) {
          setTonicFrequency(stability.avg);
          trainingRef.current = false;
          setIsTraining(false);
          setIsRagaListening(false);
          setRagaStatus('Tonic trained. Now use Raga Detection.');
          setRagaText(`Tonic frequency is ${stability.avg.toFixed(1)} Hz.`);
          stopRagaDetection();
          return;
        }
        setRagaStatus(`Training tonic... ${tonicHistoryRef.current.length} samples collected.`);
      }
      const midi = frequencyToMidi(frequency);
      const noteClass = relativePitchClass(frequency, tonicFrequency);
      noteHistoryRef.current.push(noteClass);
      if (noteHistoryRef.current.length > 120) {
        noteHistoryRef.current.shift();
      }
      if (modelTrainingRef.current) {
        modelTrainingHistoryRef.current.push(noteClass);
        if (modelTrainingHistoryRef.current.length > 240) {
          modelTrainingHistoryRef.current.shift();
        }
        setModelTrainingStatus(
          `Training ${modelTrainingLabelRef.current}: ${modelTrainingHistoryRef.current.length} notes collected.`,
        );
      }
      const trainedRaga = inferTrainedRaga(noteHistoryRef.current);
      const raga = trainedRaga || inferRaga(noteHistoryRef.current);
      setRagaStatus(`Detected note: ${scaleNoteName(noteClass)} (${frequency.toFixed(1)} Hz)`);
      setRagaText(`Best match: ${raga.name} — confidence ${raga.confidence.toFixed(0)}%`);
    } else {
      setRagaStatus('Waiting for a strong pitched note...');
    }
    rafRef.current = requestAnimationFrame(detectRagaLoop);
  };

  const startRagaDetection = async (training = false) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRagaStatus('Microphone access is not available in this browser.');
      return;
    }
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      streamRef.current = stream;
      noteHistoryRef.current = [];
      tonicHistoryRef.current = [];
      setIsTraining(training);
      trainingRef.current = training;
      setIsRagaListening(true);
      if (training) {
        setRagaStatus('Training tonic... sing a clear Sa note.');
        setRagaText('Hold Sa steadily and keep the pitch stable.');
      } else {
        setRagaStatus('Listening for ragas... sing now.');
        setRagaText('Detected raga will appear here after you sing.');
      }
      detectRagaLoop();
    } catch (error) {
      setRagaStatus(`Microphone permission denied or unavailable: ${error.message}`);
    }
  };

  const toggleRagaDetection = () => {
    if (isRagaListening) {
      stopRagaDetection();
    } else {
      startRagaDetection(false);
    }
  };

  const toggleTonicTraining = () => {
    if (isTraining) {
      stopRagaDetection();
      return;
    }
    if (isRagaListening) {
      stopRagaDetection();
    }
    startRagaDetection(true);
  };

  const toggleModelTraining = () => {
    if (isModelTraining) {
      modelTrainingRef.current = false;
      setIsModelTraining(false);
      if (modelTrainingHistoryRef.current.length >= 20) {
        saveTrainedModel(selectedTrainingRaga, modelTrainingHistoryRef.current);
        setModelTrainingStatus(`Saved training sample for ${selectedTrainingRaga}.`);
      } else {
        setModelTrainingStatus('Training canceled; not enough notes collected.');
      }
      modelTrainingHistoryRef.current = [];
      stopRagaDetection();
      return;
    }
    if (isRagaListening) {
      stopRagaDetection();
    }
    modelTrainingLabelRef.current = selectedTrainingRaga;
    modelTrainingHistoryRef.current = [];
    modelTrainingRef.current = true;
    setIsModelTraining(true);
    setModelTrainingStatus(`Training ${selectedTrainingRaga}: sing notes now.`);
    startRagaDetection(false);
  };

  return (
    <div className="app-shell">
      <div className="card">
        <h1>Voice Input (React)</h1>
        <p>Click the button and speak into your microphone. The recognized text appears below.</p>

        <div className="controls">
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="te-IN">Telugu</option>
            <option value="en-US">English</option>
          </select>
          <button onClick={toggleListening} disabled={!supported}>
            {isListening ? 'Stop Listening' : 'Start Listening'}
          </button>
          <span className="status">{status}</span>
        </div>

        <div className="raga-card">
          <div className="raga-controls">
            <button type="button" onClick={toggleRagaDetection} disabled={!supported}>
              {isRagaListening ? 'Stop Raga Detection' : 'Start Raga Detection'}
            </button>
            <span className="status">{ragaStatus}</span>
          </div>
          <div className="raga-training">
            <button type="button" onClick={toggleTonicTraining} disabled={!supported}>
              {isTraining ? 'Cancel Tonic Training' : 'Train Tonic'}
            </button>
            <span className="tonic-info">
              {tonicFrequency ? `Tonic: ${tonicFrequency.toFixed(1)} Hz` : 'Tonic not set'}
            </span>
          </div>
          <div className="model-training">
            <select value={selectedTrainingRaga} onChange={(event) => setSelectedTrainingRaga(event.target.value)}>
              {supportedRagas.map((raga) => (
                <option key={raga.name} value={raga.name}>
                  {raga.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={toggleModelTraining} disabled={!supported}>
              {isModelTraining ? 'Stop Model Training' : 'Start Model Training'}
            </button>
            <button type="button" onClick={clearTrainedModels} disabled={!Object.keys(trainedModels).length}>
              Reset Model
            </button>
            <span className="training-info">{modelTrainingStatus}</span>
            <p className="trained-models">
              Trained ragas: {Object.keys(trainedModels).length ? Object.keys(trainedModels).join(', ') : 'None'}
            </p>
          </div>
          <p className="raga-output">{ragaText}</p>
        </div>

        <label htmlFor="transcript">Transcript</label>
        <textarea id="transcript" readOnly value={transcript} rows={9} />

        <div className="note">
          <strong>Note:</strong> This uses the browser Speech Recognition API and works best in Chrome or Edge.
        </div>
      </div>
    </div>
  );
}
