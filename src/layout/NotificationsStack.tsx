import { NotificationTypes } from "./NotificationTypes";
import { useNotifications } from "./useNotifications";

export const NotificationsStack: React.FC = () => {
  const notifications = useNotifications();
  return (
    <div className="toast z-50">
      {notifications.map(({ id, message, notificationType }) => (
        <div
          role="alert"
          className={`text-sm font-light alert ${
            notificationType === NotificationTypes.error
              ? "alert-error"
              : notificationType === NotificationTypes.warning
                ? "alert-warning"
                : notificationType === NotificationTypes.success
                  ? "alert-success"
                  : "alert-info"
          } shadow-sm`}
          key={id}
        >
          <div>
            {message.length === 1 ? (
              <span>{message[0]}</span>
            ) : (
              <ul>
                {message.map((m, idx) => (
                  <li key={`${id}-${idx}`}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
