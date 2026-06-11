
'use client';

import React, { useEffect, useState, useTransition, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from './ui/input';
import { useToast } from '@/hooks/use-toast';
import type { SmtpSettings } from '@/types';
import { Checkbox } from './ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { sendEmail, getApiKey, regenerateApiKey } from '@/app/actions';
import { Loader2, Mail, Key, Eye, EyeOff, RefreshCw, Copy, Check } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const smtpSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().min(1, 'Port is required'),
  secure: z.boolean().optional(),
  user: z.string().min(1, 'Username is required'),
  pass: z.string().min(1, 'Password is required'),
  fromEmail: z.string().email('Invalid email address'),
  fromName: z.string().min(1, 'From name is required'),
});

const smtpTemplates = [
    { name: 'Custom SMTP', host: '', port: 587, secure: true },
    { name: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true },
    { name: 'Outlook/Hotmail', host: 'smtp-mail.outlook.com', port: 587, secure: false },
    { name: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    { name: 'iCloud', host: 'smtp.mail.me.com', port: 587, secure: false },
    { name: 'Resend', host: 'smtp.resend.com', port: 465, secure: true, user: 'resend' },
];

type SmtpSettingsViewProps = {
  settings: SmtpSettings;
  onSave: (settings: SmtpSettings) => void;
};

export default function SmtpSettingsView({ settings, onSave }: SmtpSettingsViewProps) {
  const { toast } = useToast();
  const [isSending, startSendTransition] = useTransition();
  const [testEmail, setTestEmail] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(true);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const fetchApiKey = useCallback(async () => {
    setApiKeyLoading(true);
    const result = await getApiKey();
    if (result.success) setApiKey(result.key ?? null);
    setApiKeyLoading(false);
  }, []);

  useEffect(() => { fetchApiKey(); }, [fetchApiKey]);

  const handleRegenerateApiKey = async () => {
    setIsRegenerating(true);
    const result = await regenerateApiKey();
    if (result.success) {
      setApiKey(result.key ?? null);
      setApiKeyVisible(true);
      toast({ title: 'API Key Regenerated', description: 'Your old key is now invalid. Update any integrations using it.' });
    } else {
      toast({ variant: 'destructive', title: 'Failed', description: result.error });
    }
    setIsRegenerating(false);
  };

  const handleCopyApiKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setApiKeyCopied(true);
    setTimeout(() => setApiKeyCopied(false), 2000);
  };

  const maskedKey = apiKey
    ? apiKey.slice(0, 8) + '•'.repeat(Math.max(0, apiKey.length - 12)) + apiKey.slice(-4)
    : '';
  
  const form = useForm<z.infer<typeof smtpSchema>>({
    resolver: zodResolver(smtpSchema),
    defaultValues: settings,
  });

  useEffect(() => {
    form.reset(settings);
  }, [settings, form]);

  const onSubmit = (values: z.infer<typeof smtpSchema>) => {
    onSave(values);
    toast({ title: 'SMTP Settings Saved' });
  };
  
  const handleTemplateChange = (templateName: string) => {
    const template = smtpTemplates.find(t => t.name === templateName);
    if (template) {
        form.setValue('host', template.host);
        form.setValue('port', template.port);
        form.setValue('secure', template.secure);
        if (template.user) {
            form.setValue('user', template.user);
            form.setValue('pass', 'YOUR_RESEND_API_KEY');
        }
    }
  };

  const handleSendTestEmail = () => {
    if (!testEmail) {
        toast({ variant: 'destructive', title: 'Recipient needed', description: 'Please enter an email address to send the test to.' });
        return;
    }
    
    startSendTransition(async () => {
        const currentSettings = form.getValues();
        const { success, error } = await sendEmail({
            to: testEmail,
            subject: 'OnDuty SMTP Test Email',
            htmlBody: `<p>This is a test email from the OnDuty application. If you received this, your SMTP settings are working correctly.</p>`
        }, currentSettings);

        if (success) {
            toast({ title: 'Test Email Sent!', description: `Successfully sent an email to ${testEmail}.` });
        } else {
            toast({ variant: 'destructive', title: 'Test Failed', description: error || 'Could not send test email.' });
        }
    });
  };

  return (
    <>
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle>Email Settings</CardTitle>
            <CardDescription>
              Configure your SMTP email service for sending notifications and reports.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Using Resend?</AlertTitle>
                <AlertDescription>
                    Select the "Resend" template, enter "resend" as the username, and use your Resend API key as the password.
                </AlertDescription>
             </Alert>

             <div className="space-y-2">
                <Label>Template</Label>
                 <Select onValueChange={handleTemplateChange}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select a template..." />
                    </SelectTrigger>
                    <SelectContent>
                        {smtpTemplates.map(template => (
                            <SelectItem key={template.name} value={template.name}>
                                {template.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
             <div className="grid grid-cols-[3fr_1fr] gap-4">
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SMTP Host</FormLabel>
                    <FormControl><Input {...field} placeholder="smtp.example.com" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
               <FormField
                control={form.control}
                name="user"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input {...field} placeholder="your_username" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="pass"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password / API Key</FormLabel>
                    <FormControl><Input type="text" {...field} placeholder="your_password" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
             <div className="grid grid-cols-2 gap-4">
               <FormField
                control={form.control}
                name="fromEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Email</FormLabel>
                    <FormControl><Input type="email" {...field} placeholder="noreply@example.com" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="fromName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Name</FormLabel>
                    <FormControl><Input {...field} placeholder="OnDuty Notifier" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="secure"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4">
                     <FormControl>
                        <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                        <FormLabel>
                        Use SSL/TLS
                        </FormLabel>
                    </div>
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit">Save Changes</Button>
          </CardFooter>
        </form>
      </Form>
      <Separator />
       <CardHeader>
            <CardTitle>Test Settings</CardTitle>
            <CardDescription>Send a test email to verify your configuration is working correctly. Uses the settings in the form above.</CardDescription>
       </CardHeader>
       <CardContent className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="testEmail">Recipient Email</Label>
                <Input id="testEmail" type="email" placeholder="recipient@example.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} />
            </div>
       </CardContent>
       <CardFooter>
            <Button variant="outline" onClick={handleSendTestEmail} disabled={isSending}>
                {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                Send Test Email
            </Button>
       </CardFooter>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" />API Key</CardTitle>
        <CardDescription>
          Used to authenticate calls to <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/import-schedule</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/backup</code>, <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/restore</code>, and <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/reports/*</code>.
          The key is stored securely in the database — never in the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {apiKeyLoading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : apiKey ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm bg-muted px-3 py-2 rounded-md border overflow-x-auto">
                {apiKeyVisible ? apiKey : maskedKey}
              </code>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setApiKeyVisible(v => !v)} title={apiKeyVisible ? 'Hide' : 'Show'}>
                {apiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleCopyApiKey} title="Copy to clipboard">
                {apiKeyCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Pass this key as <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;key&gt;</code> or <code className="bg-muted px-1 rounded">x-api-key</code> header on all API requests.</p>
          </div>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">No API key configured yet. Generate one below to enable the API.</p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" onClick={handleRegenerateApiKey} disabled={isRegenerating}>
          {isRegenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {apiKey ? 'Regenerate Key' : 'Generate Key'}
        </Button>
        {apiKey && <p className="text-xs text-muted-foreground">Regenerating immediately invalidates the current key.</p>}
      </CardFooter>
    </Card>
    </>
  );
}
