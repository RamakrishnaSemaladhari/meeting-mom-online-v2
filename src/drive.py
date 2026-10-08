import os,json,requests
TOKEN_URL="https://oauth2.googleapis.com/token"
DRIVE="https://www.googleapis.com/drive/v3"
UPLOAD="https://www.googleapis.com/upload/drive/v3/files"
class DriveClient:
 def __init__(self):
  self.client_id=os.environ["GOOGLE_CLIENT_ID"]; self.client_secret=os.environ["GOOGLE_CLIENT_SECRET"]; self.refresh_token=os.environ["GOOGLE_REFRESH_TOKEN"]; self.access_token=None
 def token(self):
  if self.access_token:return self.access_token
  r=requests.post(TOKEN_URL,data={"client_id":self.client_id,"client_secret":self.client_secret,"refresh_token":self.refresh_token,"grant_type":"refresh_token"},timeout=60);r.raise_for_status();self.access_token=r.json()["access_token"];return self.access_token
 def headers(self):return {"Authorization":"Bearer "+self.token()}
 def get_meta(self,file_id):
  r=requests.get(f"{DRIVE}/files/{file_id}",params={"fields":"id,name,mimeType,size,parents"},headers=self.headers(),timeout=60);r.raise_for_status();return r.json()
 def download(self,file_id,path):
  meta=self.get_meta(file_id)
  with requests.get(f"{DRIVE}/files/{file_id}",params={"alt":"media"},headers=self.headers(),stream=True,timeout=120) as r:
   r.raise_for_status()
   with open(path,"wb") as f:
    for b in r.iter_content(1024*1024):
     if b:f.write(b)
  return meta
 def create_folder(self,name,parent_id):
  meta={"name":name,"mimeType":"application/vnd.google-apps.folder"}
  if parent_id:meta["parents"]=[parent_id]
  r=requests.post(f"{DRIVE}/files",headers={**self.headers(),"Content-Type":"application/json"},json=meta,timeout=60);r.raise_for_status();return r.json()
 def delete(self,file_id):
  r=requests.delete(f"{DRIVE}/files/{file_id}",headers=self.headers(),timeout=60);r.raise_for_status()
 def upload(self,path,name,parent_id,mime):
  meta={"name":name}
  if parent_id:meta["parents"]=[parent_id]
  with open(path,"rb") as f:
   r=requests.post(UPLOAD,params={"uploadType":"multipart"},headers=self.headers(),files={"metadata":("metadata.json",json.dumps(meta),"application/json; charset=UTF-8"),"file":(name,f,mime)},timeout=300)
  r.raise_for_status();return r.json()
