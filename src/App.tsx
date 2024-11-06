import "./App.css";
// import { AuthProvider } from "@/auth/AuthContext";
import { AuthRoutes } from "@/routes";

export const App = () => {
  return (
    // <AuthProvider>
    <AuthRoutes />
    // </AuthProvider>
  );
};
