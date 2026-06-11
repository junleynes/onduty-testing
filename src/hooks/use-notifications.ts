'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Notification } from '@/types';
import { getNotifications, addDbNotification, markNotificationsRead, deleteNotification } from '@/app/actions';

// Convert DB row → in-memory Notification shape
function toNotification(row: { id: string; employee_id: string; message: string; is_read: boolean; link: string | null; ts: string }): Notification {
    return {
        id: row.id,
        message: row.message,
        timestamp: new Date(row.ts),
        isRead: row.is_read,
        employeeId: row.employee_id,
        link: row.link ?? undefined,
    };
}

const POLL_INTERVAL_MS = 30_000; // poll every 30 seconds for new notifications

export const useNotifications = () => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loaded, setLoaded] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Load notifications from DB
    const loadNotifications = useCallback(async () => {
        try {
            const result = await getNotifications();
            if (result.success && result.data) {
                setNotifications(result.data.map(toNotification));
            }
        } catch {
            // silently fail (user may not be logged in yet)
        } finally {
            setLoaded(true);
        }
    }, []);

    // Initial load + polling
    useEffect(() => {
        loadNotifications();
        intervalRef.current = setInterval(loadNotifications, POLL_INTERVAL_MS);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [loadNotifications]);

    // Add a global (admin/manager broadcast) notification — written to DB for current user
    const addNotification = useCallback(async (notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => {
        // Optimistic local add so the UI updates immediately
        const tempId = `temp-${Date.now()}-${Math.random()}`;
        const optimistic: Notification = {
            ...notification,
            id: tempId,
            timestamp: new Date(),
            isRead: false,
        };
        setNotifications(prev => [optimistic, ...prev]);

        // If this notification targets a specific employee, write to DB
        if (notification.employeeId) {
            try {
                await addDbNotification({
                    employeeId: notification.employeeId,
                    message: notification.message,
                    link: notification.link,
                });
                // Reload to get the real DB id
                await loadNotifications();
            } catch { /* leave the optimistic entry */ }
        }
    }, [loadNotifications]);

    // Add a notification targeted to a specific user — persists to DB
    const addNotificationForUser = useCallback(async (notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => {
        if (!notification.employeeId) return;
        try {
            await addDbNotification({
                employeeId: notification.employeeId,
                message: notification.message,
                link: notification.link,
            });
            // Reload so the current user sees any notifications addressed to them
            await loadNotifications();
        } catch { /* silently fail */ }
    }, [loadNotifications]);

    // Mark all or specific notifications as read
    const markAllRead = useCallback(async (ids?: string[]) => {
        setNotifications(prev =>
            prev.map(n => (!ids || ids.includes(n.id)) ? { ...n, isRead: true } : n)
        );
        try {
            await markNotificationsRead(ids);
        } catch { /* */ }
    }, []);

    // Delete a single notification
    const removeNotification = useCallback(async (id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
        try {
            await deleteNotification(id);
        } catch { /* */ }
    }, []);

    return {
        notifications,
        setNotifications,
        addNotification,
        addNotificationForUser,
        markAllRead,
        removeNotification,
        reloadNotifications: loadNotifications,
        loaded,
    };
};
