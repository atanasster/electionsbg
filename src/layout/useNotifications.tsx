import { useContext } from "react";
import { NotificationsContext } from "./NotificationsContext";

export const useNotifications = () => {
  const { notifications } = useContext(NotificationsContext);
  return notifications;
};

export const useAddNotification = () => {
  const { addNotification } = useContext(NotificationsContext);
  return addNotification;
};
