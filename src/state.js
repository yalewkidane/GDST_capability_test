const fs = require('fs');
const path = require('path');

const STATE_PATH = path.resolve(__dirname, '..', '.capability-state.json');

function read() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`Failed to parse ${STATE_PATH}: ${e.message}`);
  }
}

function write(next) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2) + '\n');
}

function update(patch) {
  const next = { ...read(), ...patch };
  write(next);
  return next;
}

function clear() {
  if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
}

function requireField(name) {
  const s = read();
  if (!s[name]) {
    throw new Error(`State missing field "${name}". Run prerequisite command first (state file: ${STATE_PATH}).`);
  }
  return s[name];
}

module.exports = { read, write, update, clear, requireField, STATE_PATH };
