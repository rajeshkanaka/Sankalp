'use client';

import { useState, type FormEvent } from 'react';
import { requestJson } from '@/components/api';
import { RequestErrorMessage } from '@/components/request-error';
import styles from '@/styles/sanctuary.module.css';

export function SignInForm({
  localMail,
  invalidLink,
}: {
  localMail: boolean;
  invalidLink: boolean;
}) {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestJson('/api/auth/sign-in', 'POST', { email: email.trim() });
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : new Error('Could not request a sign-in link. Try again.'),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <h2>{sent ? 'Check for your sign-in link' : 'Begin with your intention'}</h2>
      <p className={styles.muted}>
        {sent
          ? 'Follow the link to open your private practice space.'
          : 'Sign in with an email link. No password to remember.'}
      </p>
      {invalidLink && (
        <div className={styles.error} role="alert">
          That sign-in link is invalid or has expired. Request a new link below.
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          name="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setSent(false);
          }}
          disabled={pending}
          aria-describedby="email-help"
        />
        <small id="email-help">Your journeys are private to your account.</small>
      </div>
      <RequestErrorMessage error={error} />
      {sent && (
        <div className={styles.success} role="status">
          <p>
            {localMail
              ? 'A sign-in link was requested in the local mail inbox. No email was sent outside this device.'
              : 'If this address can receive sign-in links, a new link is on its way. Check your inbox and spam folder.'}
          </p>
        </div>
      )}
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? 'Requesting link…' : sent ? 'Send another link' : 'Send sign-in link'}
      </button>
      <p className={styles.welcomeFoot}>
        Set your own practices and schedule. Notifications and sound always wait for your choice.
      </p>
      {localMail && (
        <p className={styles.quietNote}>
          Local development. Open the captured link in the development mail inbox.
        </p>
      )}
    </form>
  );
}
