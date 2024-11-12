import { useNavigate } from "react-router-dom";

export const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="w-9/12 m-auto py-16 min-h-screen flex items-center justify-center">
      <div className="bg-neutral-content shadow overflow-hidden sm:rounded-lg pb-8">
        <div className="border-t border-gray-200 text-center pt-8">
          <h1 className="text-9xl font-bold text-accent">404</h1>
          <h1 className="text-6xl font-medium py-8">Oops! Page not found</h1>
          <p className="text-2xl pb-8 px-12 font-medium">
            The page you are looking for does not exist. It might have been
            moved or deleted.
          </p>
          <button onClick={() => navigate("/")} className="btn btn-primary">
            HOME
          </button>
        </div>
      </div>
    </div>
  );
};
