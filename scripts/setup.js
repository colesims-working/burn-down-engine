/**
 * Interactive setup script for the Burn-Down Engine.
 *
 * Prompts for a password, generates the bcrypt hash (with proper escaping),
 * a session secret, and writes them into .env.local.
 *
 * Usage: npm run setup
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '..', '.env.local');
const EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function setup() {
  console.log('\n🔥 Burn-Down Engine Setup\n');

  // Load existing .env.local or .env.example as template
  let envContent;
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    console.log('Found existing .env.local — will update auth values.\n');
  } else if (fs.existsSync(EXAMPLE_PATH)) {
    envContent = fs.readFileSync(EXAMPLE_PATH, 'utf-8');
    console.log('Creating .env.local from template.\n');
  } else {
    console.error('❌ No .env.example found. Are you in the project root?');
    process.exit(1);
  }

  // Prompt for password
  const password = await ask('Choose a login password: ');
  if (!password || password.length < 4) {
    console.error('❌ Password must be at least 4 characters.');
    process.exit(1);
  }

  // Generate bcrypt hash — single-quote so dotenv doesn't expand $
  const hash = await bcrypt.hash(password, 10);

  // Generate session secret
  const sessionSecret = crypto.randomBytes(32).toString('hex');

  // Update or insert values
  envContent = setEnvValue(envContent, 'APP_PASSWORD_HASH', "'" + hash + "'");
  envContent = setEnvValue(envContent, 'SESSION_SECRET', sessionSecret);

  fs.writeFileSync(ENV_PATH, envContent, 'utf-8');

  console.log('\n✅ .env.local updated:');
  console.log('   • APP_PASSWORD_HASH set (bcrypt)');
  console.log('   • SESSION_SECRET generated (64 hex chars)');
  console.log('\n📝 Still need to fill in manually:');
  console.log('   • TODOIST_API_TOKEN');
  console.log('   • GEMINI_API_KEY');
  console.log('   • ANTHROPIC_API_KEY');
  console.log('   • OPENAI_API_KEY');
  console.log('   • TURSO_DATABASE_URL');
  console.log('   • TURSO_AUTH_TOKEN');
  console.log('\nThen run: npm run dev\n');
}

function setEnvValue(content, key, value) {
  // Match the key with any existing value (including comments)
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}=${value}`);
  }
  // Key not found — append it
  return content + `\n${key}=${value}\n`;
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
