// Display name for the publisher of the GastroFlow applications.
export const platformPublisher = 'RS Orunara';

export function displayPlatformCompany(company) {
  const value = String(company ?? '').trim();
  if (!value || /^(?:RS|RS Technolog(?:y|ies)|RS Velmora Systems)$/i.test(value)) {
    return platformPublisher;
  }
  return value;
}
