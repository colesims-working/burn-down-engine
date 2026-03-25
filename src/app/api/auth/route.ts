import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const { password, action } = await request.json();

  if (action === 'logout') {
    const session = await getSession();
    session.destroy();
    return NextResponse.json({ success: true });
  }

  // Login
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) {
    return NextResponse.json(
      { error: 'Server not configured. Set APP_PASSWORD_HASH env var.' },
      { status: 500 }
    );
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const session = await getSession();
  session.authenticated = true;
  session.loginAt = new Date().toISOString();
  await session.save();

  return NextResponse.json({ success: true });
}
