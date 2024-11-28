import { useNavigate } from "react-router-dom";
import { usePreserveParams } from "./usePreserveParams";

export const useNavigateParams = () => {
  const navigate = useNavigate();
  const preserveParams = usePreserveParams();
  const navigateParams: (params: {
    pathname: string;
    search?: { [key: string]: string };
  }) => void = ({ pathname, search }) => {
    const params = preserveParams(search);
    navigate({
      pathname,
      search: params.toString(),
    });
  };
  return navigateParams;
};
