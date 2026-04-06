import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.DATABASE_PATH ? dirname(process.env.DATABASE_PATH) : '/app/data';
const CREDS_FILE = join(DATA_DIR, '.pikabu_creds');
const ENCRYPTION_KEY = (process.env.PIKABU_ENCRYPTION_KEY || 'pikabu-bot-v3-default-key-32ch!').padEnd(32, '0').slice(0, 32);

function getKey(): Buffer {
  return Buffer.from(ENCRYPTION_KEY, 'utf-8');
}

interface CredentialsData {
  username: string;
  cookies: string;
  isActive: boolean;
}

// Store one set of credentials (username + cookies)
export async function setPikabuCredentials(chatId: number, username: string, cookies: string): Promise<{ success: boolean; error?: string }> {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  
  const data: CredentialsData = {
    username,
    cookies,
    isActive: true
  };
  
  writeFileSync(CREDS_FILE, JSON.stringify(data), 'utf-8');
  return { success: true };
}

export async function getPikabuCredentials(chatId: number): Promise<{ username: string; cookies: string; isActive: boolean } | null> {
  if (!existsSync(CREDS_FILE)) return null;
  
  try {
    const data: CredentialsData = JSON.parse(readFileSync(CREDS_FILE, 'utf-8'));
    return data;
  } catch (e) {
    console.error('[Credentials] Failed to read:', e);
    return null;
  }
}

export async function hasPikabuCredentials(chatId: number): Promise<boolean> {
  return existsSync(CREDS_FILE);
}

export async function deletePikabuCredentials(chatId: number): Promise<void> {
  if (existsSync(CREDS_FILE)) {
    unlinkSync(CREDS_FILE);
  }
}

export async function togglePikabuCredentials(chatId: number): Promise<void> {
  if (!existsSync(CREDS_FILE)) return;
  
  try {
    const data: CredentialsData = JSON.parse(readFileSync(CREDS_FILE, 'utf-8'));
    data.isActive = !data.isActive;
    writeFileSync(CREDS_FILE, JSON.stringify(data), 'utf-8');
  } catch {}
}
