-- Fix: "invalid input value for enum unit_status: """ when handing over / changing unit status
-- Cause 1: COALESCE(OLD.status, '') forced an empty string cast to unit_status.
-- Cause 2: maintenance_requests.status was set to 'closed', which is not in maintenance_status ('open','in_progress','done').

CREATE OR REPLACE FUNCTION public.close_maintenance_on_available()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'available'::unit_status AND OLD.status IS DISTINCT FROM 'available'::unit_status THEN
    UPDATE public.maintenance_requests
       SET status = 'done'::maintenance_status
     WHERE unit_id = NEW.id
       AND status IN ('open'::maintenance_status, 'in_progress'::maintenance_status);
  END IF;
  RETURN NEW;
END;
$function$;
