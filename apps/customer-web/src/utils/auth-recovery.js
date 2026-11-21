// A transient connection or server outage is not proof of an invalid session.
export function shouldForgetCustomerSession(error) {
  return error?.status === 401 || error?.status === 403;
}
