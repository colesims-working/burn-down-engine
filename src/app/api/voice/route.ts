import { NextRequest, NextResponse } from 'next/server';
import { processVoiceDump } from '@/lib/voice/whisper';
import { isAuthenticated } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const audioFile = formData.get('audio') as File;

  if (!audioFile) {
    return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const result = await processVoiceDump(buffer, audioFile.type);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Voice processing error:', error);
    return NextResponse.json(
      { error: 'Failed to process audio' },
      { status: 500 }
    );
  }
}
