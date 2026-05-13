import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { DestinationSummary } from './DestinationSummary';
import type { FileOption, MailAttachment, MailThread, OneTimeSendMode, TemplateOption } from './types';

type MailboxOption = {
  id: string;
  email: string;
  emailNormalized: string;
  label?: string | null;
  isPrimary: boolean;
  isActive: boolean;
};

type Prefill = {
  mode?: OneTimeSendMode;
  subject?: string;
  templateId?: string | null;
  projectId?: string;
  invoiceId?: string | null;
  attachment?: MailAttachment;
};

type Props = {
  clientId: string;
  clientEmails: MailboxOption[];
  defaultEmail?: string;
  threads: MailThread[];
  templates: TemplateOption[];
  fileOptions: FileOption[];
  prefill?: Prefill | null;
  onOpenThread: (threadId: string) => void;
};

function parseList(value: string) {
  return value
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function fileToAttachment(file: FileOption): MailAttachment {
  return {
    clientFileId: file.clientFileId ?? undefined,
    invoiceId: file.invoiceId ?? undefined,
    projectFileId: file.projectFileId ?? undefined,
    fileName: file.originalName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    storagePath: `/storage/uploads/${file.storedName}`
  };
}

export function OneTimeComposer(props: Props) {
  const queryClient = useQueryClient();
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedEmails = useMemo(
    () => props.clientEmails.filter(item => item.isActive).map(item => item.emailNormalized || item.email.toLowerCase()),
    [props.clientEmails]
  );
  const resolvedDefaultEmail =
    props.defaultEmail?.trim().toLowerCase() ||
    props.clientEmails.find(item => item.isPrimary && item.isActive)?.emailNormalized ||
    normalizedEmails[0] ||
    '';
  const [mode, setMode] = useState<OneTimeSendMode>(props.prefill?.mode ?? 'new_thread');
  const [threadId, setThreadId] = useState('');
  const [templateId, setTemplateId] = useState(props.prefill?.templateId ?? '');
  const [subject, setSubject] = useState(props.prefill?.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState('');
  const [ccText, setCcText] = useState('');
  const [bccText, setBccText] = useState('');
  const [toEmail, setToEmail] = useState(resolvedDefaultEmail);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [attachments, setAttachments] = useState<MailAttachment[]>(props.prefill?.attachment ? [props.prefill.attachment] : []);

  const selectedTemplate = useMemo(
    () => props.templates.find(template => template.id === templateId),
    [props.templates, templateId]
  );

  const selectedThread = useMemo(
    () => props.threads.find(thread => thread.id === threadId),
    [props.threads, threadId]
  );

  const ccList = useMemo(() => parseList(ccText), [ccText]);
  const bccList = useMemo(() => parseList(bccText), [bccText]);

  useEffect(() => {
    if (!selectedTemplate) return;
    setSubject(prev => prev || selectedTemplate.subject);
    setBodyHtml(selectedTemplate.body);
  }, [selectedTemplate]);

  useEffect(() => {
    setToEmail(resolvedDefaultEmail);
  }, [resolvedDefaultEmail]);

  useEffect(() => {
    if (mode === 'reply_thread' && !threadId && props.threads.length > 0) {
      setThreadId(props.threads[0].id);
    }
  }, [mode, threadId, props.threads]);

  useEffect(() => {
    if (mode !== 'reply_thread') return;
    if (!selectedThread?.subject) return;
    setSubject(selectedThread.subject);
  }, [mode, selectedThread?.id, selectedThread?.subject]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        clientId: props.clientId,
        mode,
        threadId: mode === 'reply_thread' ? threadId : undefined,
        toEmail,
        subject: mode === 'reply_thread' ? (selectedThread?.subject || subject) : subject,
        bodyHtml,
        templateId: templateId || undefined,
        cc: ccList,
        bcc: bccList,
        projectId: props.prefill?.projectId,
        invoiceId: props.prefill?.invoiceId || undefined,
        messageType: props.prefill?.invoiceId ? 'invoice' : 'manual',
        attachments
      };

      return api.post<{ thread: MailThread; message: { id: string } }>('/mail/compose/one-time', payload);
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ['mail-client-threads', props.clientId] });
      if (result.thread?.id) {
        props.onOpenThread(result.thread.id);
      }
    }
  });

  const onPickLocalAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const contentBase64 = await readFileAsBase64(file);
      setAttachments(prev => {
        if (prev.some(item => (item.projectFileId ? false : `${item.fileName}:${item.fileSize}` === `${file.name}:${file.size}`))) {
          return prev;
        }
        return [
          ...prev,
          {
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size,
            storagePath: `upload://${file.name}:${file.size}:${file.lastModified}`,
            contentBase64
          }
        ];
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to attach local file');
    }
  };

  return (
    <div className="mail-composer-card">
      <div className="mail-context-badge">{mode === 'new_thread' ? 'New thread' : `In thread #${(threadId || '').slice(-8)}`}</div>

      <div className="mail-inline-grid">
        <label className="info-field">
          <span className="muted small">Recipient</span>
          <select className="input" value={toEmail} onChange={event => setToEmail(event.target.value)}>
            {!toEmail ? <option value="">Select recipient email</option> : null}
            {normalizedEmails.map(email => (
              <option key={email} value={email}>{email}</option>
            ))}
          </select>
        </label>

        <label className="info-field">
          <span className="muted small">Template</span>
          <select className="input" value={templateId} onChange={event => setTemplateId(event.target.value)}>
            <option value="">Custom draft</option>
            {props.templates.map(template => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mail-inline-grid">
        <label className="info-field">
          <span className="muted small">Mode</span>
          <select className="input" value={mode} onChange={event => setMode(event.target.value as OneTimeSendMode)}>
            <option value="new_thread">Send as new thread</option>
            <option value="reply_thread">Attach to existing thread</option>
          </select>
        </label>

        <label className="info-field">
          <span className="muted small">Thread</span>
          <select
            className="input"
            value={threadId}
            onChange={event => setThreadId(event.target.value)}
            disabled={mode !== 'reply_thread'}
          >
            <option value="">Select thread</option>
            {props.threads.map(thread => (
              <option key={thread.id} value={thread.id}>{thread.subject}</option>
            ))}
          </select>
        </label>
      </div>

      <input
        className="input"
        placeholder="Email subject"
        value={mode === 'reply_thread' ? (selectedThread?.subject || subject) : subject}
        onChange={event => setSubject(event.target.value)}
        readOnly={mode === 'reply_thread'}
      />
      <textarea className="input textarea" placeholder="Message body" value={bodyHtml} onChange={event => setBodyHtml(event.target.value)} />

      <div className="mail-inline-grid">
        <input className="input" placeholder="CC (comma separated)" value={ccText} onChange={event => setCcText(event.target.value)} />
        <input className="input" placeholder="BCC (comma separated)" value={bccText} onChange={event => setBccText(event.target.value)} />
      </div>

      <div className="mail-attach-row">
        <input
          ref={localFileInputRef}
          type="file"
          className="files-upload-native-input"
          onChange={event => {
            void onPickLocalAttachment(event);
          }}
        />
        <select className="input" value={selectedFileId} onChange={event => setSelectedFileId(event.target.value)}>
          <option value="">Attach file from client storage</option>
          {props.fileOptions.map(file => (
            <option key={file.id} value={file.id}>{file.kind ? `${file.kind}: ${file.originalName}` : file.originalName}</option>
          ))}
        </select>
        <button
          className="ghost-btn"
          type="button"
          onClick={() => {
            const file = props.fileOptions.find(item => item.id === selectedFileId);
            if (!file) return;
            setAttachments(prev => {
              if (prev.some(item => item.storagePath === `/storage/uploads/${file.storedName}`)) return prev;
              return [...prev, fileToAttachment(file)];
            });
            setSelectedFileId('');
          }}
          disabled={!selectedFileId}
        >
          Add attachment
        </button>
        <button
          className="ghost-btn"
          type="button"
          onClick={() => localFileInputRef.current?.click()}
        >
          Attach local file
        </button>
      </div>

      {attachments.length ? (
        <div className="mail-attachment-list">
          {attachments.map(attachment => (
            <button
              key={`${attachment.storagePath || attachment.projectFileId || attachment.invoiceId || attachment.fileName}`}
              type="button"
              className="mail-attachment-chip removable"
              onClick={() => setAttachments(prev => prev.filter(item => `${item.storagePath || item.projectFileId || item.invoiceId || item.fileName}` !== `${attachment.storagePath || attachment.projectFileId || attachment.invoiceId || attachment.fileName}`))}
            >
              {attachment.fileName} x
            </button>
          ))}
        </div>
      ) : null}

      <DestinationSummary
        recipient={toEmail || '-'}
        selectedTemplate={selectedTemplate}
        mode={mode}
        selectedThread={selectedThread}
        attachments={attachments}
        cc={ccList}
        bcc={bccList}
      />

      <div className="inline-actions">
        <button
          className="primary-btn"
          type="button"
          onClick={() => sendMutation.mutate()}
          disabled={
            sendMutation.isPending ||
            !toEmail ||
            subject.trim().length < 2 ||
            bodyHtml.trim().length < 2 ||
            (mode === 'reply_thread' && !threadId)
          }
        >
          {sendMutation.isPending ? 'Sending...' : 'Send one-time email'}
        </button>
        {sendMutation.isError ? <span className="muted small">{sendMutation.error instanceof Error ? sendMutation.error.message : 'Failed to send email.'}</span> : null}
        {sendMutation.isSuccess ? <span className="muted small">Email sent and thread updated.</span> : null}
      </div>
    </div>
  );
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return reject(new Error('Failed to read local file'));
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read local file'));
    reader.readAsDataURL(file);
  });
}
