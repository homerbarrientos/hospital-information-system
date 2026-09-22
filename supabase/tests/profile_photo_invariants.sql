-- Hospital ONE patient and doctor profile-photo integrity checks.
-- PASS CONDITION: every query returns zero rows.

select id,mrn,profile_photo_path,profile_photo_mime,profile_photo_size
from public.patients
where profile_photo_path is not null
  and (profile_photo_mime not in ('image/jpeg','image/png') or profile_photo_size not between 1 and 3145728);

select id,license_number,profile_photo_path,profile_photo_mime,profile_photo_size
from public.doctors
where profile_photo_path is not null
  and (profile_photo_mime not in ('image/jpeg','image/png') or profile_photo_size not between 1 and 3145728);

select id,mrn
from public.patients
where (profile_photo_path is null)<>(profile_photo_name is null)
   or (profile_photo_path is null)<>(profile_photo_mime is null)
   or (profile_photo_path is null)<>(profile_photo_size is null);

select id,license_number
from public.doctors
where (profile_photo_path is null)<>(profile_photo_name is null)
   or (profile_photo_path is null)<>(profile_photo_mime is null)
   or (profile_photo_path is null)<>(profile_photo_size is null);
