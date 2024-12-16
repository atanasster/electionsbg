import { useNavigate } from "react-router-dom";
import { usePreserveParams } from "./usePreserveParams";

export type NavigateParams = {
  pathname: string;
  search?: { [key: string]: string };
};

export const useNavigateParams = () => {
  const navigate = useNavigate();
  const preserveParams = usePreserveParams();
  const navigateParams: (params: NavigateParams) => void = ({
    pathname,
    search,
  }) => {
    const params = preserveParams(search);
    navigate({
      pathname,
      search: params.toString(),
    });
  };
  return navigateParams;
};
