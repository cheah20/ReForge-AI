/**
 * src/frontend/main.tsx
 *
 * Browser entry. Not wrapped in React StrictMode: its doubled effects in
 * development would send every analysis request twice, and in real-AI mode
 * that spends neurons for nothing.
 */

import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './tokens.css';
import './app.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<App />);
