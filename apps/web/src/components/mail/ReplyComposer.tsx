import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Send, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import type { FileOption, MailAttachment, MailThread, TemplateOption } from './types';
import { DestinationSummary } from './DestinationSummary';

type Props = {
  thread: MailThread;
  recipient: string;
  fileOptions: FileOption[];
  templates: TemplateOption[];
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

export function ReplyComposer(props: Props) {
  const queryClient = useQueryClient();
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const [bodyHtml, setBodyHtml] = useState('');
  const [ccText, setCcText] = useState('');
  const [bccText, setBccText] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [selectedFileId, setSelectedFileId] = useState('');
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [refineTone, setRefineTone] = useState<'professional' | 'friendly' | 'concise'>('professional');
  const [fixGrammarOnly, setFixGrammarOnly] = useState(false);
  const [refineOriginal, setRefineOriginal] = useState('');
  const [refinedDraft, setRefinedDraft] = useState('');
  const [refineNotes, setRefineNotes] = useState('');

  const ccList = useMemo(() => parseList(ccText), [ccText]);
  const bccList = useMemo(() => parseList(bccText), [bccText]);
  const selectedTemplate = useMemo(
    () => props.templates.find(template => template.id === templateId),
    [props.templates, templateId]
  );

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post(`/mail/threads/${props.thread.id}/reply`, {
        bodyHtml,
        templateId: templateId || undefined,
        cc: ccList,
        bcc: bccList,
        attachments
      }),
    onSuccess: () => {
      setBodyHtml('');
      setCcText('');
      setBccText('');
      setTemplateId('');
      setAttachments([]);
      queryClient.invalidateQueries({ queryKey: ['mail-thread-messages', props.thread.id] });
      queryClient.invalidateQueries({ queryKey: ['mail-client-threads', props.thread.clientId] });
    }
  });

  const refineMutation = useMutation({
    mutationFn: async () =>
      api.post<{ refinedDraft: string; notes?: string }>('/mail/refine-draft', {
        draft: bodyHtml,
        tone: refineTone,
        mode: fixGrammarOnly ? 'fix_grammar_only' : 'keep_meaning',
        threadContext: {
          subject: props.thread.subject,
          lastMessageSnippet: props.thread.lastMessageSnippet
        },
        clientContext: {
          email: props.recipient
        }
      }),
    onSuccess: result => {
      setRefineOriginal(bodyHtml);
      setRefinedDraft(result.refinedDraft);
      setRefineNotes(result.notes || '');
    }
  });

  useEffect(() => {
    if (!refineOriginal) return;
    if (bodyHtml === refineOriginal) return;
    setRefineOriginal('');
    setRefinedDraft('');
    setRefineNotes('');
  }, [bodyHtml, refineOriginal]);

  const onPickLocalAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const contentBase64 = await readFileAsBase64(file);
      setAttachments(prev => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (prev.some(item => (item.projectFileId ? false : `${item.fileName}:${item.fileSize}` === `${file.name}:${file.size}`))) {
          return prev;
        }
        return [
          ...prev,
          {
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size,
            storagePath: `upload://${key}`,
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
      <div className="mail-composer-top">
        <div className="mail-context-badge">Thread #{props.thread.id.slice(-8)}</div>
        <span className="muted small">Replying to {props.recipient}</span>
      </div>
      <label className="info-field">
        <span className="muted small">Template</span>
        <select
          className="input"
          value={templateId}
          onChange={event => {
            const value = event.target.value;
            setTemplateId(value);
            if (!value) return;
            const template = props.templates.find(item => item.id === value);
            if (template) setBodyHtml(template.body);
          }}
        >
          <option value="">Custom reply</option>
          {props.templates.map(template => (
            <option key={template.id} value={template.id}>{template.name}</option>
          ))}
        </select>
      </label>
      <textarea
        className="input textarea mail-reply-textarea"
        placeholder="Type a message..."
        value={bodyHtml}
        onChange={event => setBodyHtml(event.target.value)}
      />
      <div className="mail-refine-controls">
        <select
          className="input"
          value={refineTone}
          onChange={event => setRefineTone(event.target.value as 'professional' | 'friendly' | 'concise')}
        >
          <option value="professional">Professional tone</option>
          <option value="friendly">Friendly tone</option>
          <option value="concise">Concise tone</option>
        </select>
        <label className="mail-checkbox-row">
          <input
            type="checkbox"
            checked={fixGrammarOnly}
            onChange={event => setFixGrammarOnly(event.target.checked)}
          />
          Fix grammar only
        </label>
        <button
          className="ghost-btn"
          type="button"
          disabled={refineMutation.isPending || bodyHtml.trim().length < 2}
          onClick={() => refineMutation.mutate()}
        >
          <Sparkles size={15} />
          <span>{refineMutation.isPending ? 'Refining...' : 'Refine'}</span>
        </button>
      </div>

      {refinedDraft ? (
        <div className="mail-refine-preview">
          <div className="mail-refine-grid">
            <label className="info-field">
              <span className="muted small">Original</span>
              <textarea className="input textarea mail-refine-textarea" value={refineOriginal} readOnly />
            </label>
            <label className="info-field">
              <span className="muted small">Refined</span>
              <textarea className="input textarea mail-refine-textarea" value={refinedDraft} readOnly />
            </label>
          </div>
          {refineNotes ? <span className="muted small">{refineNotes}</span> : null}
          <div className="inline-actions">
            <button
              className="primary-btn"
              type="button"
              onClick={() => {
                setBodyHtml(refinedDraft);
                setRefineOriginal('');
                setRefinedDraft('');
                setRefineNotes('');
              }}
            >
              Use refined
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => {
                setRefineOriginal('');
                setRefinedDraft('');
                setRefineNotes('');
              }}
            >
              Keep original
            </button>
          </div>
        </div>
      ) : null}

      {refineMutation.isError ? <span className="muted small">Failed to refine draft. Original text is unchanged.</span> : null}

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
          <Paperclip size={15} />
          <span>Local file</span>
        </button>
      </div>

      {attachments.length ? (
        <div className="mail-attachment-list">
          {attachments.map(item => (
            <button
              key={`${item.storagePath || item.projectFileId || item.invoiceId || item.fileName}`}
              type="button"
              className="mail-attachment-chip removable"
              onClick={() => setAttachments(prev => prev.filter(entry => `${entry.storagePath || entry.projectFileId || entry.invoiceId || entry.fileName}` !== `${item.storagePath || item.projectFileId || item.invoiceId || item.fileName}`))}
            >
              {item.fileName} x
            </button>
          ))}
        </div>
      ) : null}

      <DestinationSummary
        recipient={props.recipient}
        selectedTemplate={selectedTemplate}
        mode="reply_thread"
        selectedThread={props.thread}
        attachments={attachments}
        cc={ccList}
        bcc={bccList}
      />

      <div className="inline-actions">
        <button
          className="primary-btn mail-send-btn"
          type="button"
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending || bodyHtml.trim().length < 2}
        >
          <Send size={16} />
          <span>{sendMutation.isPending ? 'Sending...' : 'Send'}</span>
        </button>
        {sendMutation.isError ? <span className="muted small">{sendMutation.error instanceof Error ? sendMutation.error.message : 'Failed to send reply.'}</span> : null}
        {sendMutation.isSuccess ? <span className="muted small">Reply sent.</span> : null}
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
