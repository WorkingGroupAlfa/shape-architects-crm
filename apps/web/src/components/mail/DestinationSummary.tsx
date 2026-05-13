import type { MailAttachment, MailThread, OneTimeSendMode, TemplateOption } from './types';

type Props = {
  recipient: string;
  selectedTemplate?: TemplateOption;
  mode: OneTimeSendMode;
  selectedThread?: MailThread;
  attachments: MailAttachment[];
  cc: string[];
  bcc: string[];
};

export function DestinationSummary(props: Props) {
  return (
    <div className="mail-destination-summary">
      <div className="mail-destination-title">Destination Summary</div>
      <div className="mail-destination-grid">
        <span><strong>Recipient:</strong> {props.recipient || '-'}</span>
        <span><strong>Template:</strong> {props.selectedTemplate?.name || 'Custom'}</span>
        <span><strong>Mode:</strong> {props.mode === 'new_thread' ? 'New thread' : 'Existing thread'}</span>
        <span><strong>Thread:</strong> {props.mode === 'reply_thread' ? props.selectedThread?.subject || 'Not selected' : 'New thread'}</span>
        <span><strong>CC:</strong> {props.cc.length ? props.cc.join(', ') : '-'}</span>
        <span><strong>BCC:</strong> {props.bcc.length ? props.bcc.join(', ') : '-'}</span>
        <span className="mail-destination-span2"><strong>Attachments:</strong> {props.attachments.length ? props.attachments.map(item => item.fileName).join(', ') : '-'}</span>
      </div>
    </div>
  );
}
