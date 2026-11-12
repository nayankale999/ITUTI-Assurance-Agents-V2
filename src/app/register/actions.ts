'use server';
import { z } from 'zod';
import { startRegistration, registrationOpen } from '@/lib/registration';
import { cleanSource } from '@/lib/subscription';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid work email address.').max(254),
  orgName: z.string().trim().min(2, 'Enter your organisation’s name.').max(120),
  terms: z.literal('on', { errorMap: () => ({ message: 'Confirm that you may register on behalf of your organisation.' }) }),
});

export type RegisterState = { error?: string; email?: string; existing?: boolean } | null;

/** Records the sign-up. The client then asks for a sign-in link, which proves the email address. */
export async function registerClient(_: RegisterState, fd: FormData): Promise<RegisterState> {
  if (!registrationOpen()) return { error: 'Sign-up is closed. Ask your Ituti contact for an invitation.' };
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Check the form and try again.' };
  try {
    const r = await startRegistration({ ...parsed.data, source: cleanSource(fd.get('source')) });
    return { email: parsed.data.email, existing: r === 'existing' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Something went wrong. Try again.' };
  }
}
