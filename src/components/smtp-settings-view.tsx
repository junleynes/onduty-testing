
'use client';

import React, { useEffect, useState, useTransition } from 'react';
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
import { sendEmail } from '@/app/actions';
import { Loader2, Mail, Key } from 'lucide-react';
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
  const [apiKey, setApiKey] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('import_api_key') || '';
    return '';
  });
  
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
        <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" />Import API Key</CardTitle>
        <CardDescription>
          Set the secret API key required by the <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/import-schedule</code> endpoint for external integrations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="importApiKey">Secret API Key</Label>
          <Input
            id="importApiKey"
            type="text"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Enter secret token..."
            className="font-mono"
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={() => {
          if (!apiKey.trim()) return;
          localStorage.setItem('import_api_key', apiKey.trim());
          toast({ title: 'API Key Saved' });
        }}>
          <Key className="h-4 w-4 mr-2" />Save API Key
        </Button>
      </CardFooter>
    </Card>
    </>
  );
}
