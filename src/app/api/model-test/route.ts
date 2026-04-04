import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth/session';
import { testModel } from '@/lib/llm/providers';
import type { Provider } from '@/lib/db/settings';

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { provider, model } = await request.json();
  if (!provider || !model) {
    return NextResponse.json({ error: 'provider and model required' }, { status: 400 });
  }

  const result = await testModel(provider as Provider, model);
  return NextResponse.json(result);
}
