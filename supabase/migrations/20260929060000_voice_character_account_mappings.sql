-- 2026-09-29: Map 9 English voice characters to the user's own ElevenLabs
-- voice IDs (collected from their account voice library via "Copy voice ID").
-- Mapping (character -> ElevenLabs voice name -> voice ID):
--   sawyer   -> Charlie  -> IKne3meq5aSn9XLyUdCD
--   darian   -> Eric     -> cjVigY5qzO86Huf0OWal
--   finley   -> Will     -> bIHbv24MWmeRgasZH58o
--   jade     -> Bella    -> hpp4J3VqNfWAUOO0d1Us
--   elara    -> Lily     -> pFZP5JQG7iQjIQuC4Bku
--   talia    -> Jessica  -> cgSgspJ2msm6clMCkdW9
--   lawrence -> Bill     -> pqHfZKP75CvOlQylNhV4
--   warren   -> Brian    -> nPczCjzI2devNBz1zQrb
--   florence -> Sarah    -> EXAVITQu4vr4xnSDxMaL
-- Adam and Elli were already mapped. The remaining 29 characters
-- (all Hindi / Spanish / German) stay unmapped until native voices are added.

UPDATE public.voice_characters SET provider_voice_id = 'IKne3meq5aSn9XLyUdCD', status = 'mapped' WHERE id = 'sawyer';
UPDATE public.voice_characters SET provider_voice_id = 'cjVigY5qzO86Huf0OWal', status = 'mapped' WHERE id = 'darian';
UPDATE public.voice_characters SET provider_voice_id = 'bIHbv24MWmeRgasZH58o', status = 'mapped' WHERE id = 'finley';
UPDATE public.voice_characters SET provider_voice_id = 'hpp4J3VqNfWAUOO0d1Us', status = 'mapped' WHERE id = 'jade';
UPDATE public.voice_characters SET provider_voice_id = 'pFZP5JQG7iQjIQuC4Bku', status = 'mapped' WHERE id = 'elara';
UPDATE public.voice_characters SET provider_voice_id = 'cgSgspJ2msm6clMCkdW9', status = 'mapped' WHERE id = 'talia';
UPDATE public.voice_characters SET provider_voice_id = 'pqHfZKP75CvOlQylNhV4', status = 'mapped' WHERE id = 'lawrence';
UPDATE public.voice_characters SET provider_voice_id = 'nPczCjzI2devNBz1zQrb', status = 'mapped' WHERE id = 'warren';
UPDATE public.voice_characters SET provider_voice_id = 'EXAVITQu4vr4xnSDxMaL', status = 'mapped' WHERE id = 'florence';
