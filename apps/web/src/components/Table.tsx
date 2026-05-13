import { PropsWithChildren } from 'react';

export function Table({ children }: PropsWithChildren) {
  return <div className="table-wrap"><table className="table">{children}</table></div>;
}
