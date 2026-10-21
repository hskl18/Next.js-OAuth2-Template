type AuthEmail = { to: string; subject: string; text: string }

// shortcut: only a development console transport exists, so email flows are
// disabled in production; wire a provider into sendAuthEmail before deploying them.
export function isEmailDeliveryConfigured() {
  return process.env.NODE_ENV !== "production"
}

export async function sendAuthEmail(email: AuthEmail) {
  if (!isEmailDeliveryConfigured()) throw new EmailDeliveryNotConfiguredError()
  console.info(`[auth email] to=${email.to} subject=${email.subject}\n${email.text}`)
}

export class EmailDeliveryNotConfiguredError extends Error {
  constructor() {
    super("No email transport is configured for this deployment")
    this.name = "EmailDeliveryNotConfiguredError"
  }
}
