
'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from './ui/button';
import { PlusCircle, Pencil, Trash2, Settings, AlertTriangle } from 'lucide-react';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import type { FaqItem, Employee } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type FaqViewProps = {
  faqs: FaqItem[];
  setFaqs: React.Dispatch<React.SetStateAction<FaqItem[]>>;
  currentUser: Employee;
};

export default function FaqView({ faqs, setFaqs, currentUser }: FaqViewProps) {
  const { toast } = useToast();
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<FaqItem> | null>(null);
  
  const isLocalAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';

  const handleAddItem = () => {
    setEditingItem({ id: uuidv4(), question: '', answer: '' });
  };

  const handleEditItem = (item: FaqItem) => {
    setEditingItem(item);
  };

  const handleSaveItem = () => {
    if (!editingItem?.question?.trim() || !editingItem?.answer?.trim()) {
      toast({ 
        variant: 'destructive', 
        title: 'Validation Error', 
        description: 'Both question and answer are required.' 
      });
      return;
    }

    setFaqs(prev => {
      const exists = prev.find(f => f.id === editingItem.id);
      if (exists) {
        return prev.map(f => f.id === editingItem.id ? editingItem as FaqItem : f);
      }
      return [...prev, editingItem as FaqItem];
    });
    
    setEditingItem(null);
    toast({ title: 'FAQ Item Saved' });
  };

  const handleDeleteItem = (id: string) => {
    setFaqs(prev => prev.filter(f => f.id !== id));
    toast({ title: 'FAQ Item Removed', variant: 'destructive' });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <CardTitle>Frequently Asked Questions</CardTitle>
            <CardDescription>Find answers to common questions or manage help topics.</CardDescription>
          </div>
          {isLocalAdmin && (
              <div className="flex gap-2">
                  <Button variant={isEditingMode ? "default" : "outline"} size="sm" onClick={() => setIsEditingMode(!isEditingMode)}>
                      <Settings className="h-4 w-4 mr-2" />
                      {isEditingMode ? 'Done Managing' : 'Manage FAQs'}
                  </Button>
                  {isEditingMode && (
                      <Button size="sm" onClick={handleAddItem}>
                          <PlusCircle className="h-4 w-4 mr-2" />
                          Add New Topic
                      </Button>
                  )}
              </div>
          )}
        </CardHeader>
        <CardContent>
          {isEditingMode && editingItem && (
              <Card className="mb-8 border-primary bg-primary/5">
                  <CardHeader>
                      <CardTitle className="text-lg">{editingItem.id && faqs.some(f => f.id === editingItem.id) ? 'Edit FAQ Item' : 'New FAQ Item'}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div className="space-y-2">
                          <label className="text-sm font-medium">Question</label>
                          <Input 
                              value={editingItem.question} 
                              onChange={e => setEditingItem({ ...editingItem, question: e.target.value })} 
                              placeholder="Enter the question..."
                          />
                      </div>
                      <div className="space-y-2">
                          <label className="text-sm font-medium">Answer</label>
                          <Textarea 
                              value={editingItem.answer} 
                              onChange={e => setEditingItem({ ...editingItem, answer: e.target.value })} 
                              placeholder="Enter the answer..."
                              rows={5}
                          />
                      </div>
                  </CardContent>
                  <div className="flex justify-end gap-2 p-4 pt-0">
                      <Button variant="ghost" onClick={() => setEditingItem(null)}>Cancel</Button>
                      <Button onClick={handleSaveItem}>Save FAQ Item</Button>
                  </div>
              </Card>
          )}

          <Accordion type="single" collapsible className="w-full">
            {faqs.map((item) => (
              <AccordionItem key={item.id} value={item.id} className="border-b">
                <div className="flex items-center gap-2 group">
                  <AccordionTrigger className="flex-1 hover:no-underline py-4 text-left">
                    <span className="font-semibold text-primary/90">{item.question}</span>
                  </AccordionTrigger>
                  {isEditingMode && (
                      <div className="flex gap-1 pr-4">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 hover:bg-primary/10 hover:text-primary" 
                            onClick={(e) => {
                                e.stopPropagation();
                                handleEditItem(item);
                            }}
                          >
                              <Pencil className="h-4 w-4" />
                          </Button>
                          
                          <AlertDialog>
                              <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                      <Trash2 className="h-4 w-4" />
                                  </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                  <AlertDialogHeader>
                                      <AlertDialogTitle className="flex items-center gap-2">
                                          <AlertTriangle className="h-5 w-5 text-destructive" />
                                          Delete FAQ Item?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                          Are you sure you want to remove the question: <strong>"{item.question}"</strong>? This action cannot be undone.
                                      </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction 
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        onClick={() => handleDeleteItem(item.id)}
                                      >
                                          Delete
                                      </AlertDialogAction>
                                  </AlertDialogFooter>
                              </AlertDialogContent>
                          </AlertDialog>
                      </div>
                  )}
                </div>
                <AccordionContent className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap pb-6 px-1">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          {faqs.length === 0 && !editingItem && (
               <div className="text-center text-muted-foreground p-12 border-2 border-dashed rounded-lg bg-muted/20">
                  <HelpCircle className="mx-auto h-12 w-12 opacity-20 mb-4" />
                  <p className="text-lg font-medium">No FAQ topics found.</p>
                  {isLocalAdmin && <p className="text-sm mt-2">Click "Add New Topic" to start building your knowledge base.</p>}
              </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HelpCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}
