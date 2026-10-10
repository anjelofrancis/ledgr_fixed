-- Quotations convert into sales paid by bank transfer, which the original CHECK rejected.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash', 'mpesa', 'card', 'bank_transfer'));
