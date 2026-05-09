# Voice Input App

A simple browser-based app that captures microphone input and converts speech to text.

## How to use

1. Open `index.html` in a modern browser such as Chrome or Edge.
2. Click **Start Listening**.
3. Speak clearly into your microphone.
4. The recognized text appears in the transcript box.

## Notes

- This app uses the Web Speech API (`SpeechRecognition`).
- It works best in Chrome or Edge on desktop.
- If the browser does not support the API, the button is disabled and the app shows a support message.

### Telugu support

Both the plain HTML app and the React app now support Telugu speech recognition.
Choose `Telugu` from the language dropdown to recognize speech using `te-IN`.

## React version

A React version of the voice input app is available under `react/`.

### Run the React app

1. `cd react`
2. `npm install`
3. `npm run dev`

Open the local Vite URL in a modern browser.

## Carnatic raga recognition

Both the plain HTML app and the React app now include a "Raga Detection" mode. Sing a phrase and the app will analyze pitch content to match common Carnatic ragas such as Shankarabharanam, Kalyani, Mohanam, Kambhoji, Todi, and Hindolam.

### How to use

1. Open the app in a browser.
2. Click **Start Raga Detection**.
3. Sing in a steady pitch.
4. The app displays the best matching raga and confidence estimate.
5. Use **Train Tonic** to calibrate your tonic pitch before detection. Sing a clear Sa note, then run detection again for more accurate Carnatic mapping.
