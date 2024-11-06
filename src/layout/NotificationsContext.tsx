import { createContext, useCallback, useState } from 'react';
import uuid from 'react-uuid';
import { NotificationTypes } from './NotificationTypes';

type Notification = {
  id: string;
  notificationType: NotificationTypes;
  message: string[];
};

type UserNotification = Omit<Notification, 'id'>;
type Notifications = Notification[];
type NotificationsContextType = {
  addNotification: (notification: UserNotification) => void;
  notifications: Notifications;
};

export const NotificationsContext = createContext<NotificationsContextType>(
  {} as NotificationsContextType,
);

export const NotificationsContextProvider: React.FC<
  React.PropsWithChildren<{ interval?: number }>
> = ({ children, interval = 10 * 1000 }) => {
  const [notifications, setNotifications] = useState<Notifications>([]);
  const addNotification: NotificationsContextType['addNotification'] =
    useCallback(
      (notification) => {
        const isDuplicate = notifications.find((n) => {
          return (
            n.notificationType === notification.notificationType &&
            n.message.length === notification.message.length &&
            n.message.every((m, i) => m === notification.message[i])
          );
        });
        if (!isDuplicate) {
          const id = uuid();
          setNotifications([...notifications, { ...notification, id }]);
          setTimeout(() => {
            setNotifications(notifications.filter((n) => n.id !== id));
          }, interval);
        }
      },
      [interval, notifications],
    );
  return (
    <NotificationsContext.Provider
      value={{
        addNotification,
        notifications,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
};
