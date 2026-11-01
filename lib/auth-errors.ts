/**
 * Turn Supabase auth errors into words a restaurant owner can act on.
 * Raw provider messages stay only as the fallback for cases we do not know.
 */
export function friendlyAuthError(message: string): string {
  const text = message || 'Something went wrong. Please try again.'
  if (/invalid login credentials/i.test(text)) {
    return 'The email or password is not right. Check both and try again — or reset the password below.'
  }
  if (/email not confirmed/i.test(text)) {
    return 'This account is not confirmed yet. Open the confirmation email we sent, then come back and sign in.'
  }
  if (/user already registered/i.test(text)) {
    return 'That email already has an account. Sign in instead — or reset the password if the account is yours.'
  }
  if (/provider is not enabled|unsupported provider/i.test(text)) {
    return 'Google sign-in is not switched on for getinvoiceIQ yet. Please use email and password for now.'
  }
  if (/password should be at least/i.test(text)) {
    return 'Use a password with at least 8 characters.'
  }
  if (/failed to fetch|network|load failed/i.test(text)) {
    return 'We could not reach the sign-in service. Check your connection and try again.'
  }
  if (/token has expired|refresh token/i.test(text)) {
    return 'That sign-in link has expired. Request a fresh one and try again.'
  }
  return text
}
