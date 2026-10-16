-- BL-224: V62 (applied, immutable) describes the helpdesk model as knowing 20 synthetic FAQ articles; the demo knowledge base is wider
-- (the run note shows the live count). The card now says what is true whatever the count. Text only: no behaviour or data changes.
UPDATE ai_model
   SET description = 'Keyword retrieval, not a language model: TF-IDF cosine similarity between the question and the synthetic FAQ articles. Returns the top three articles with scores, a suggested category and a draft reply assembled from the best article.',
       limitations = 'Knows only the synthetic FAQ articles. No case data. Below the confidence threshold it says escalate to a person. The draft is never sent by the system.'
 WHERE use_case = 'helpdesk-assist';
