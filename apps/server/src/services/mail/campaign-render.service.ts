import type { Client, EmailTemplate } from '@prisma/client';

export function renderCampaignTemplate(template: EmailTemplate, client: Client) {
  const variables: Record<string, string> = {
    name: client.name || '',
    company: client.company || '',
    email: client.email || '',
    phone: client.phone || '',
    clientNumber: client.clientNumber || ''
  };

  return {
    subject: applyVariables(template.subject, variables),
    bodyHtml: applyVariables(template.body, variables)
  };
}

function applyVariables(input: string, variables: Record<string, string>) {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return typeof value === 'string' ? value : '';
  });
}
