
/**
 * MEETING ONLINE V2 — PRIVATE CONTROL TOWER
 * Single-file Apps Script Web App.
 *
 * PURPOSE
 * - Private dashboard hosted by Google Apps Script
 * - Creates/maintains the V2 Google Sheets database
 * - Creates the V2 Google Drive workspace
 * - Dispatches GitHub Actions
 * - Captures GitHub workflow run ID/URL
 * - Tracks meetings, events, chunks and analytics
 * - Provides diagnostics and secret/configuration checklist
 *
 * IMPORTANT
 * 1. Do NOT put GitHub PATs, OAuth secrets or refresh tokens in this file.
 * 2. Secrets are stored in Apps Script Script Properties.
 * 3. GitHub Actions secrets remain in GitHub Secrets.
 * 4. Deploy the Web App as: Execute as ME; access for any logged-in Google user, subject to Google Workspace and OAuth restrictions.
 *
 * V2 IDs
 * GitHub repo: RamakrishnaSemaladhari/meeting-mom-online-v2
 */

const V2 = {
  VERSION: 'meeting-mom-online-v2-control-tower-2026-10-10-r1',
  TIMEZONE: 'Asia/Kolkata',
  SPREADSHEET_ID_PROPERTY: 'MMV2_SPREADSHEET_ID',
  REPO: 'RamakrishnaSemaladhari/meeting-mom-online-v2',
  WORKFLOW_FILE: 'meeting-mom-v2.yml',
  WORKFLOW_REF: 'main',
  WORKFLOW_INPUT_NAME: 'payload_json',
  GITHUB_TOKEN_PROPERTY: 'GITHUB_TOKEN',
  CALLBACK_SECRET_PROPERTY: 'MMV2_CALLBACK_SECRET',
  ROOT_FOLDER_PROPERTY: 'MMV2_ROOT_FOLDER_ID',
  AUDIO_FOLDER_PROPERTY: 'MMV2_AUDIO_FOLDER_ID',
  MEETINGS_FOLDER_PROPERTY: 'MMV2_MEETINGS_FOLDER_ID',
  PROCESSING_FOLDER_PROPERTY: 'MMV2_PROCESSING_FOLDER_ID'
};

const SHEETS = {
  MEETINGS: 'MEETINGS',
  EVENTS: 'MEETING_EVENTS',
  CHUNKS: 'CHUNKS',
  DAILY: 'ANALYTICS_DAILY',
  MONTHLY: 'ANALYTICS_MONTHLY',
  SYSTEM: 'SYSTEM_ANALYTICS',
  CONFIG: 'CONFIG'
};

const MEETING_HEADERS = [
  'Meeting ID','Parent Meeting ID','Recording Attempt','Meeting Title','Meeting Initiator',
  'Meeting Mode','Processing Engine','Meeting Date','Start Time','End Time',
  'Meeting Duration Minutes','Audio Duration Minutes','Audio File Size Bytes',
  'Audio MIME Type','Recording Device','Device Type','Operating System','Browser',
  'Venue','Agenda','Participants','Detected Languages','Status','Current Stage',
  'Overall Percent','ETA Seconds','Processing Start','Processing End','Processing Time Seconds',
  'Audio File ID','Audio Folder ID','Meeting Folder ID','Processing Folder ID','Reports Folder ID',
  'Manifest File ID','Transcript File ID','Translation File ID','Summary File ID','MoM File ID',
  'Word File ID','GitHub Run ID','GitHub Run Number','GitHub Run URL','GitHub Workflow',
  'GitHub Workflow Attempt','GitHub SHA','Processing Mode','Chunk Count','Completed Chunks',
  'Failed Chunks','Retry Count','Resume Count','Workflow Attempt','Whisper Model','LLM Model',
  'First Pass Success','Redo Required','Redo Reason','Stopped By','Error Code','Error Message',
  'Recovery Status','Created At','Updated At','Completed At'
];

const EVENT_HEADERS = [
  'Event ID','Timestamp','Meeting ID','Recording Attempt','Event','Stage','Progress Percent',
  'ETA Seconds','Chunk No','Message','Status','GitHub Run ID','GitHub Run Number',
  'Workflow Attempt','Device','Processing Seconds','Metadata JSON'
];

const CHUNK_HEADERS = [
  'Chunk ID','Meeting ID','Recording Attempt','Chunk No','Start Seconds','End Seconds',
  'Duration Seconds','Drive Chunk File ID','Transcript File ID','Translation File ID',
  'Summary File ID','Status','Attempt','Processing Start','Processing End',
  'Processing Seconds','Error Code','Error Message','Updated At'
];

const DAILY_HEADERS = [
  'Date','Meetings Started','Meetings Completed','Meetings Failed','Meetings Stopped',
  'Meetings Queued','Meetings Processing','Meetings Redo','Meetings Reprocessed',
  'First Pass Success','Total Meeting Minutes','Total Audio Minutes',
  'Average Meeting Minutes','Average Audio Minutes','Average Processing Seconds',
  'Total Processing Seconds','Success Rate Percent','First Pass Success Percent'
];

const MONTHLY_HEADERS = [
  'Month','Meetings Started','Meetings Completed','Meetings Failed','Meetings Stopped',
  'Meetings Redo','Meetings Reprocessed','Total Meeting Minutes','Total Audio Minutes',
  'Average Meeting Minutes','Average Audio Minutes','Average Processing Seconds',
  'Success Rate Percent','First Pass Success Percent'
];

const SYSTEM_HEADERS = [
  'Timestamp','Meeting ID','GitHub Run ID','Workflow','Workflow Attempt','Stage',
  'Runner','Whisper Model','LLM Model','Chunk Count','Completed Chunks','Failed Chunks',
  'Audio Minutes','Processing Seconds','Status','Message'
];

/* =========================
 * WEB APP
 * ========================= */

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!p.action) return dashboardHtml_();

    switch (String(p.action).toLowerCase()) {
      case 'health': return json_(health_());
      case 'dashboard': return json_(dashboard_());
      case 'meetings': return json_(listMeetings_(p));
      case 'meeting': return json_(getMeeting_(p.meeting_id || p.id));
      case 'events': return json_(getEvents_(p.meeting_id || p.id));
      case 'chunks': return json_(getChunks_(p.meeting_id || p.id));
      case 'github_status': return json_(githubStatus_());
      case 'secret_status': return json_(secretStatus_());
      case 'setup_status': return json_(setupStatus_());
      case 'setup': return json_(SETUP_V2());
      case 'github_setup': return json_(githubSetupPackage_());
      case 'analytics': return json_(analytics_(p));
      default: return json_({success:false,error:'UNKNOWN_ACTION',message:'Unknown action'});
    }
  } catch (err) {
    return json_({success:false,error:'GET_ERROR',message:String(err.message || err)});
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || '').toLowerCase();

    if (['processing_event','update_progress','complete_meeting','fail_meeting','update_report','update_reports'].indexOf(action) >= 0) {
      const expected = PropertiesService.getScriptProperties().getProperty(V2.CALLBACK_SECRET_PROPERTY) || '';
      const supplied = clean_(body.callback_secret);
      if (!expected || supplied !== expected) {
        return json_({success:false,error:'CALLBACK_AUTH_FAILED',message:'Invalid callback secret.'});
      }
    }

    switch (action) {
      case 'setup': return json_(SETUP_V2());
      case 'create_meeting': return json_(createMeeting_(body));
      case 'start_processing': return json_(startProcessing_(body));
      case 'processing_event': return json_(processingEvent_(body));
      case 'update_progress': return json_(processingEvent_(body));
      case 'complete_meeting': return json_(completeMeeting_(body));
      case 'fail_meeting': return json_(failMeeting_(body));
      case 'update_report': return json_(updateReport_(body));
      case 'update_reports': return json_(updateReport_(body));
      case 'record_chunk': return json_(recordChunk_(body));
      default: return json_({success:false,error:'UNKNOWN_ACTION',message:'Unknown POST action'});
    }
  } catch (err) {
    return json_({success:false,error:'POST_ERROR',message:String(err.message || err)});
  }
}

/* =========================
 * ONE-TIME SETUP
 * ========================= */

function SETUP_V2() {
  const ss = SpreadsheetApp.openById(spreadsheetId_());

  ensureSheet_(ss, SHEETS.MEETINGS, MEETING_HEADERS);
  ensureSheet_(ss, SHEETS.EVENTS, EVENT_HEADERS);
  ensureSheet_(ss, SHEETS.CHUNKS, CHUNK_HEADERS);
  ensureSheet_(ss, SHEETS.DAILY, DAILY_HEADERS);
  ensureSheet_(ss, SHEETS.MONTHLY, MONTHLY_HEADERS);
  ensureSheet_(ss, SHEETS.SYSTEM, SYSTEM_HEADERS);
  ensureSheet_(ss, SHEETS.CONFIG, ['Key','Value','Sensitive','Updated At']);

  const root = getOrCreateFolder_(V2.ROOT_FOLDER_PROPERTY, 'Meeting online V2');
  const audio = getOrCreateChildFolder_(root, V2.AUDIO_FOLDER_PROPERTY, 'Audio');
  const meetings = getOrCreateChildFolder_(root, V2.MEETINGS_FOLDER_PROPERTY, 'Meetings');
  const processing = getOrCreateChildFolder_(root, V2.PROCESSING_FOLDER_PROPERTY, 'Processing');

  writeConfig_('VERSION', V2.VERSION, false);
  writeConfig_('SPREADSHEET_ID', spreadsheetId_(), false);
  writeConfig_('GITHUB_REPO', V2.REPO, false);
  writeConfig_('WORKFLOW_FILE', V2.WORKFLOW_FILE, false);
  writeConfig_('WORKFLOW_REF', V2.WORKFLOW_REF, false);
  writeConfig_('ROOT_FOLDER_ID', root.getId(), false);
  writeConfig_('AUDIO_FOLDER_ID', audio.getId(), false);
  writeConfig_('MEETINGS_FOLDER_ID', meetings.getId(), false);
  writeConfig_('PROCESSING_FOLDER_ID', processing.getId(), false);

  if (!PropertiesService.getScriptProperties().getProperty(V2.CALLBACK_SECRET_PROPERTY)) {
    generateCallbackSecret_(false);
  }

  formatAllSheets_();

  return {
    success:true,
    version:V2.VERSION,
    spreadsheet_id:ss.getId(),
    spreadsheet_url:ss.getUrl(),
    sheets:Object.keys(SHEETS).map(function(k){return SHEETS[k];}),
    folders:{
      root_id:root.getId(), root_url:root.getUrl(),
      audio_id:audio.getId(), audio_url:audio.getUrl(),
      meetings_id:meetings.getId(), meetings_url:meetings.getUrl(),
      processing_id:processing.getId(), processing_url:processing.getUrl()
    },
    github_repo:V2.REPO,
    workflow:V2.WORKFLOW_FILE,
    github_token_configured:!!PropertiesService.getScriptProperties().getProperty(V2.GITHUB_TOKEN_PROPERTY),
    callback_secret_configured:!!PropertiesService.getScriptProperties().getProperty(V2.CALLBACK_SECRET_PROPERTY),
    timestamp:now_()
  };
}

/* =========================
 * SECRET / INTEGRATION SETUP
 * =========================
 *
 * Apps Script CANNOT manufacture your GitHub PAT or Google OAuth
 * client secret. Those credentials must originate from GitHub/Google.
 *
 * This code:
 * - stores the GitHub PAT safely in Script Properties
 * - generates a random callback secret for GitHub -> Apps Script callbacks
 * - reports only whether secrets exist, never their values
 */

function SET_GITHUB_TOKEN() {
  const configured = !!PropertiesService.getScriptProperties().getProperty(V2.GITHUB_TOKEN_PROPERTY);
  return {
    success:configured,
    configured:configured,
    property:V2.GITHUB_TOKEN_PROPERTY,
    message:configured ? 'GitHub token is configured.' : 'Add GITHUB_TOKEN in Project Settings > Script properties.'
  };
}

function generateCallbackSecret_(force) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(V2.CALLBACK_SECRET_PROPERTY);
  if (!secret || force) {
    secret = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
    props.setProperty(V2.CALLBACK_SECRET_PROPERTY, secret);
  }
  return {
    success:true,
    property:V2.CALLBACK_SECRET_PROPERTY,
    secret:secret,
    warning:'Store this callback secret in GitHub Actions as MMV2_CALLBACK_SECRET. Do not put it in source code.'
  };
}

function GET_GITHUB_CALLBACK_SECRET() {
  const secret = PropertiesService.getScriptProperties().getProperty(V2.CALLBACK_SECRET_PROPERTY);
  if (!secret) return generateCallbackSecret_(false);
  return {
    success:true,
    secret:secret,
    property:V2.CALLBACK_SECRET_PROPERTY,
    warning:'This is sensitive. Do not paste it into the repository source code.'
  };
}

function secretStatus_() {
  const p = PropertiesService.getScriptProperties();
  return {
    success:true,
    github_pat:{configured:!!p.getProperty(V2.GITHUB_TOKEN_PROPERTY)},
    callback_secret:{configured:!!p.getProperty(V2.CALLBACK_SECRET_PROPERTY)},
    google_drive_oauth_required_by_current_workflow:true,
    required_github_action_secrets:[
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'MMV2_GATEWAY_URL',
      'MMV2_CALLBACK_SECRET'
    ],
    note:'Secret values are never returned by this endpoint.'
  };
}

/**
 * Run manually after SETUP_V2().
 * Produces the non-secret integration package.
 */
function GITHUB_SETUP_PACKAGE() {
  return githubSetupPackage_();
}

function githubSetupPackage_() {
  const p = PropertiesService.getScriptProperties();
  const callback = p.getProperty(V2.CALLBACK_SECRET_PROPERTY);
  return {
    success:true,
    github:{
      repository:V2.REPO,
      workflow:V2.WORKFLOW_FILE,
      ref:V2.WORKFLOW_REF,
      event_type:'meeting-ready',
      dispatch_method:'workflow_dispatch',
      required_permission:'Actions: write',
      token_property:'GITHUB_TOKEN'
    },
    apps_script:{
      version:V2.VERSION,
      spreadsheet_configured:!!PropertiesService.getScriptProperties().getProperty(V2.SPREADSHEET_ID_PROPERTY),
      gateway_url:'PASTE_YOUR_NEW_APPS_SCRIPT_EXEC_URL_HERE',
      callback_secret_property:V2.CALLBACK_SECRET_PROPERTY
    },
    github_actions_secrets:[
      {name:'GOOGLE_CLIENT_ID',source:'Google Cloud OAuth client',sensitive:true},
      {name:'GOOGLE_CLIENT_SECRET',source:'Google Cloud OAuth client',sensitive:true},
      {name:'GOOGLE_REFRESH_TOKEN',source:'Google OAuth user refresh token',sensitive:true},
      {name:'MMV2_GATEWAY_URL',source:'New Apps Script /exec URL',sensitive:false},
      {name:'MMV2_CALLBACK_SECRET',source:'GET_GITHUB_CALLBACK_SECRET()',sensitive:true}
    ],
    callback_secret_masked:callback ? mask_(callback) : '',
    note:'The Google OAuth values cannot be generated by Apps Script. They must be created through Google Cloud/OAuth. The GitHub PAT also must be created by the GitHub account owner.'
  };
}

/* =========================
 * DASHBOARD
 * ========================= */

function dashboard_() {
  const meetings = readObjects_(SHEETS.MEETINGS, MEETING_HEADERS);
  const now = new Date();
  const todayKey = dateKey_(now);
  const weekStart = startOfWeek_(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const today = meetings.filter(function(m){ return dateKey_(m['Created At']) === todayKey; });
  const week = meetings.filter(function(m){ return toDate_(m['Created At']) >= weekStart; });
  const month = meetings.filter(function(m){ return toDate_(m['Created At']) >= monthStart; });

  const summarize = function(rows) {
    const out = {
      total:rows.length, completed:0, failed:0, stopped:0, queued:0, processing:0,
      redo:0, reprocessed:0, total_meeting_minutes:0, total_audio_minutes:0,
      total_processing_seconds:0, average_meeting_minutes:0, average_audio_minutes:0,
      average_processing_seconds:0, first_pass_success:0
    };
    rows.forEach(function(m){
      const s = String(m['Status']||'').toUpperCase();
      if(s==='COMPLETED'||s==='SUCCESS') out.completed++;
      if(s==='FAILED') out.failed++;
      if(s==='STOPPED') out.stopped++;
      if(s==='QUEUED'||s==='CREATED') out.queued++;
      if(s==='PROCESSING') out.processing++;
      if(String(m['Redo Required']).toUpperCase()==='YES') out.redo++;
      if(Number(m['Recording Attempt']||1)>1) out.reprocessed++;
      out.total_meeting_minutes += num_(m['Meeting Duration Minutes']);
      out.total_audio_minutes += num_(m['Audio Duration Minutes']);
      out.total_processing_seconds += num_(m['Processing Time Seconds']);
      if(String(m['First Pass Success']).toUpperCase()==='YES') out.first_pass_success++;
    });
    if(rows.length){
      out.average_meeting_minutes = round_(out.total_meeting_minutes/rows.length,2);
      out.average_audio_minutes = round_(out.total_audio_minutes/rows.length,2);
      out.average_processing_seconds = round_(out.total_processing_seconds/rows.length,2);
    }
    out.success_rate_percent = rows.length ? round_(100*out.completed/rows.length,2) : 0;
    out.first_pass_success_percent = rows.length ? round_(100*out.first_pass_success/rows.length,2) : 0;
    return out;
  };

  return {
    success:true,
    generated_at:now_(),
    today:summarize(today),
    week:summarize(week),
    month:summarize(month),
    recent:meetings.slice(-10).reverse().map(publicMeeting_),
    device_breakdown:breakdown_(month,'Device Type'),
    status_breakdown:breakdown_(month,'Status'),
    language_breakdown:breakdown_(month,'Detected Languages')
  };
}

/* =========================
 * MEETING / EVENT / CHUNK API
 * ========================= */

function createMeeting_(d) {
  const ss = SpreadsheetApp.openById(spreadsheetId_());
  const sheet = ss.getSheetByName(SHEETS.MEETINGS);
  const meetingId = clean_(d.meeting_id) || generateMeetingId_();
  const existing = findRow_(sheet, 'Meeting ID', meetingId);
  if(existing > 1) return {success:true,existing:true,meeting_id:meetingId,row:existing};

  const root = getOrCreateFolder_(V2.MEETINGS_FOLDER_PROPERTY,'Meetings');
  const meetingFolder = root.createFolder(meetingId + ' - ' + (clean_(d.meeting_title)||'Meeting'));
  const reports = meetingFolder.createFolder('Reports');
  const processing = meetingFolder.createFolder('Processing');

  const row = {};
  MEETING_HEADERS.forEach(function(h){row[h]='';});
  row['Meeting ID']=meetingId;
  row['Parent Meeting ID']=clean_(d.parent_meeting_id);
  row['Recording Attempt']=num_(d.recording_attempt)||1;
  row['Meeting Title']=clean_(d.meeting_title)||'Untitled Meeting';
  row['Meeting Initiator']=clean_(d.meeting_initiator)||'Web App';
  row['Meeting Mode']=clean_(d.meeting_mode)||'ONLINE';
  row['Processing Engine']=clean_(d.processing_engine)||'GitHub Actions';
  row['Meeting Date']=clean_(d.meeting_date)||formatDate_(new Date());
  row['Start Time']=clean_(d.start_time);
  row['End Time']=clean_(d.end_time);
  row['Meeting Duration Minutes']=num_(d.meeting_duration_minutes);
  row['Audio Duration Minutes']=num_(d.audio_duration_minutes);
  row['Audio File Size Bytes']=num_(d.audio_file_size_bytes);
  row['Audio MIME Type']=clean_(d.audio_mime_type);
  row['Recording Device']=clean_(d.recording_device);
  row['Device Type']=clean_(d.device_type);
  row['Operating System']=clean_(d.operating_system);
  row['Browser']=clean_(d.browser);
  row['Venue']=clean_(d.venue);
  row['Agenda']=clean_(d.agenda);
  row['Participants']=clean_(d.participants);
  row['Audio File ID']=clean_(d.audio_file_id);
  row['Audio Folder ID']=clean_(d.audio_folder_id);
  row['Meeting Folder ID']=meetingFolder.getId();
  row['Processing Folder ID']=processing.getId();
  row['Reports Folder ID']=reports.getId();
  row['Status']='CREATED';
  row['Current Stage']='REGISTERED';
  row['Overall Percent']=0;
  row['Processing Mode']=clean_(d.processing_mode)||'fresh';
  row['Whisper Model']=clean_(d.whisper_model)||'small';
  row['LLM Model']=clean_(d.llm_model)||'qwen2.5:3b';
  row['Recovery Status']='READY';
  row['Created At']=new Date();
  row['Updated At']=new Date();

  appendObject_(sheet, MEETING_HEADERS, row);
  logEvent_(meetingId,'MEETING_CREATED','REGISTRATION',0,0,'Meeting registered','CREATED',null,d);
  return {
    success:true,existing:false,meeting_id:meetingId,row:sheet.getLastRow(),
    meeting_folder_id:meetingFolder.getId(),processing_folder_id:processing.getId(),
    reports_folder_id:reports.getId(),timestamp:now_()
  };
}


function uploadAndStartMeeting(form) {
  if (!form) throw new Error('Meeting form is required.');
  const blob = form.audio;
  if (!blob || !blob.getBytes || blob.getBytes().length === 0) {
    throw new Error('Please record a meeting or select an audio file.');
  }

  const audioFolder = getOrCreateFolder_(V2.AUDIO_FOLDER_PROPERTY, 'Audio');
  const meetingId = generateMeetingId_();
  const originalName = clean_(blob.getName()) || ('meeting-recording-' + meetingId + '.webm');
  const safeName = originalName.replace(/[\\/:*?"<>|#%]/g, '_').slice(0, 180);
  const meta = {
    meeting_id: meetingId,
    meeting_title: clean_(form.meeting_title) || 'Untitled Meeting',
    meeting_initiator: 'Web App',
    meeting_mode: clean_(form.venue) || 'ONLINE',
    meeting_date: clean_(form.meeting_date) || formatDate_(new Date()),
    start_time: clean_(form.start_time),
    end_time: clean_(form.end_time),
    venue: clean_(form.venue),
    agenda: clean_(form.agenda),
    participants: clean_(form.participants),
    recording_device: 'Browser Microphone / File Upload',
    device_type: 'Browser',
    browser: 'Web App',
    audio_folder_id: audioFolder.getId(),
    processing_mode: 'fresh'
  };

  const created = createMeeting_(meta);
  if (!created.success) throw new Error(created.message || 'Meeting registration failed.');

  const file = audioFolder.createFile(blob);
  file.setName(meetingId + '__' + safeName);
  const size = file.getSize();
  const mime = file.getMimeType() || blob.getContentType() || 'application/octet-stream';

  const ss = SpreadsheetApp.openById(spreadsheetId_());
  const sheet = ss.getSheetByName(SHEETS.MEETINGS);
  const rowNo = findRow_(sheet, 'Meeting ID', meetingId);
  setByHeader_(sheet, MEETING_HEADERS, rowNo, 'Audio File ID', file.getId());
  setByHeader_(sheet, MEETING_HEADERS, rowNo, 'Audio Folder ID', audioFolder.getId());
  setByHeader_(sheet, MEETING_HEADERS, rowNo, 'Audio File Size Bytes', size);
  setByHeader_(sheet, MEETING_HEADERS, rowNo, 'Audio MIME Type', mime);
  setByHeader_(sheet, MEETING_HEADERS, rowNo, 'Updated At', new Date());

  const started = startProcessing_({
    meeting_id: meetingId,
    audio_file_id: file.getId(),
    audio_folder_id: audioFolder.getId(),
    meeting_folder_id: created.meeting_folder_id,
    meeting_title: meta.meeting_title,
    processing_mode: 'fresh'
  });

  if (!started.success) {
    return {
      success:false,
      meeting_id:meetingId,
      audio_file_id:file.getId(),
      audio_folder_id:audioFolder.getId(),
      meeting_folder_id:created.meeting_folder_id,
      message:started.message || 'GitHub dispatch failed.'
    };
  }

  return {
    success:true,
    meeting_id:meetingId,
    audio_file_id:file.getId(),
    audio_folder_id:audioFolder.getId(),
    meeting_folder_id:created.meeting_folder_id,
    progress_percent:started.progress_percent || 5,
    status:started.status || 'QUEUED',
    github:started.github || {},
    audio_file_name:file.getName(),
    audio_file_size_bytes:size,
    audio_mime_type:mime,
    timestamp:now_()
  };
}

function startProcessing_(d) {
  const meetingId=clean_(d.meeting_id);
  if(!meetingId) throw new Error('meeting_id is required');

  const sheet=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.MEETINGS);
  let rowNo=findRow_(sheet,'Meeting ID',meetingId);
  if(rowNo<2) {
    createMeeting_(d);
    rowNo=findRow_(sheet,'Meeting ID',meetingId);
  }
  const row=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);

  const audioFileId=clean_(d.audio_file_id)||row['Audio File ID'];
  const audioFolderId=clean_(d.audio_folder_id)||row['Audio Folder ID'];
  const meetingFolderId=clean_(d.meeting_folder_id)||row['Meeting Folder ID'];
  if(!audioFileId) throw new Error('Audio File ID is required.');

  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Audio File ID',audioFileId);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Audio Folder ID',audioFolderId);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Meeting Folder ID',meetingFolderId);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status','QUEUED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Current Stage','DISPATCHING');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Overall Percent',5);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Processing Start',new Date());
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Processing Mode',clean_(d.processing_mode)||'fresh');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());

  const payload={
    meeting_id:meetingId,
    audio_file_id:audioFileId,
    audio_folder_id:audioFolderId,
    meeting_folder_id:meetingFolderId,
    processing_folder_id:row['Processing Folder ID'],
    reports_folder_id:row['Reports Folder ID'],
    registry_spreadsheet_id:spreadsheetId_(),
    registry_sheet:SHEETS.MEETINGS,
    processing_mode:clean_(d.processing_mode)||'fresh',
    meeting_title:clean_(d.meeting_title)||row['Meeting Title']||'Meeting',
    meeting_date:clean_(d.meeting_date)||row['Meeting Date']||'',
    start_time:clean_(d.start_time)||row['Start Time']||'',
    end_time:clean_(d.end_time)||row['End Time']||'',
    venue_mode:clean_(d.venue)||row['Venue']||row['Meeting Mode']||'',
    agenda:clean_(d.agenda)||row['Agenda']||'',
    participants:clean_(d.participants)||row['Participants']||'',
    resume_from_chunk:clean_(d.resume_from_chunk),
    retry_chunks:clean_(d.retry_chunks),
    gateway_version:V2.VERSION,
    timestamp:new Date().toISOString()
  };

  const gh=dispatchWorkflow_(payload);
  if(!gh.success) {
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status','FAILED');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Code','GITHUB_DISPATCH');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Message',gh.message);
    logEvent_(meetingId,'DISPATCH_FAILED','DISPATCH',5,0,gh.message,'FAILED',null,{});
    return {success:false,meeting_id:meetingId,error:'GITHUB_DISPATCH',message:gh.message};
  }

  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status','QUEUED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'GitHub Run ID',String(gh.run_id||''));
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'GitHub Run URL',gh.run_url||gh.html_url||'');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'GitHub Workflow',V2.WORKFLOW_FILE);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());

  logEvent_(meetingId,'GITHUB_DISPATCHED','DISPATCH',5,0,
            'GitHub Actions run queued: '+(gh.run_id||''),'QUEUED',gh.run_id,{});
  return {success:true,meeting_id:meetingId,github:gh,status:'QUEUED',progress_percent:5};
}

function processingEvent_(d) {
  const meetingId=clean_(d.meeting_id);
  if(!meetingId) throw new Error('meeting_id is required');
  const lock=LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.MEETINGS);
    const rowNo=findRow_(sheet,'Meeting ID',meetingId);
    if(rowNo<2) throw new Error('Meeting not found: '+meetingId);
    const current=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);
    const currentStatus=String(current['Status']||'').toUpperCase();
    if(['COMPLETED','FAILED','STOPPED','DELETED'].indexOf(currentStatus)>=0) {
      logEvent_(meetingId,'LATE_PROGRESS_IGNORED',clean_(d.stage)||'PROCESSING',num_(d.progress_percent),num_(d.eta_seconds),
        'Ignored late progress callback because meeting is already '+currentStatus,currentStatus,clean_(d.github_run_id),d);
      return {success:true,ignored:true,reason:'TERMINAL_STATE',meeting_id:meetingId,status:currentStatus,progress_percent:num_(current['Overall Percent'])};
    }
    const pct=Math.max(0,Math.min(99,num_(d.progress_percent)));
    let status=clean_(d.status)||'PROCESSING';
    const stage=clean_(d.stage)||'PROCESSING';
    const eta=num_(d.eta_seconds), msg=clean_(d.message);
    if(['COMPLETED','FAILED','STOPPED','DELETED'].indexOf(status.toUpperCase())>=0) status='PROCESSING';
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status',status);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Current Stage',stage);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Overall Percent',pct);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'ETA Seconds',eta);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());
    if(d.github_run_id) setByHeader_(sheet,MEETING_HEADERS,rowNo,'GitHub Run ID',String(d.github_run_id));
    if(d.github_run_number) setByHeader_(sheet,MEETING_HEADERS,rowNo,'GitHub Run Number',String(d.github_run_number));
    if(d.github_run_attempt) setByHeader_(sheet,MEETING_HEADERS,rowNo,'GitHub Workflow Attempt',String(d.github_run_attempt));
    if(d.audio_duration_minutes!==undefined) setByHeader_(sheet,MEETING_HEADERS,rowNo,'Audio Duration Minutes',num_(d.audio_duration_minutes));
    if(d.meeting_duration_minutes!==undefined) setByHeader_(sheet,MEETING_HEADERS,rowNo,'Meeting Duration Minutes',num_(d.meeting_duration_minutes));
    if(d.completed_chunks!==undefined) setByHeader_(sheet,MEETING_HEADERS,rowNo,'Completed Chunks',num_(d.completed_chunks));
    if(d.failed_chunks!==undefined) setByHeader_(sheet,MEETING_HEADERS,rowNo,'Failed Chunks',num_(d.failed_chunks));
    if(d.chunk_count!==undefined) setByHeader_(sheet,MEETING_HEADERS,rowNo,'Chunk Count',num_(d.chunk_count));
    if(d.error_code) setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Code',clean_(d.error_code));
    if(d.error_message) setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Message',clean_(d.error_message));
    logEvent_(meetingId,clean_(d.event)||'PROGRESS',stage,pct,eta,msg,status,clean_(d.github_run_id),d);
    return {success:true,meeting_id:meetingId,progress_percent:pct,status:status,stage:stage};
  } finally { lock.releaseLock(); }
}
function completeMeeting_(d) {
  const meetingId=clean_(d.meeting_id);
  if(!meetingId) throw new Error('meeting_id is required');
  const lock=LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.MEETINGS);
    const rowNo=findRow_(sheet,'Meeting ID',meetingId);
    if(rowNo<2) throw new Error('Meeting not found.');
    const current=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);
    const currentStatus=String(current['Status']||'').toUpperCase();
    if(currentStatus==='STOPPED'||currentStatus==='DELETED')
      return {success:false,ignored:true,reason:'TERMINAL_STATE',meeting_id:meetingId,status:currentStatus,message:'Completion callback ignored because meeting was stopped or deleted.'};
    const start=current['Processing Start'], end=new Date();
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status','COMPLETED');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Current Stage','COMPLETED');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Overall Percent',100);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'ETA Seconds',0);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Processing End',end);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Processing Time Seconds',start?Math.max(0,(end-new Date(start))/1000):0);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Completed At',current['Completed At']||end);
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'First Pass Success',num_(current['Recording Attempt'])<=1?'YES':'NO');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Recovery Status','COMPLETE');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',end);
    Object.keys(d).forEach(function(k){
      const map={manifest_file_id:'Manifest File ID',transcript_file_id:'Transcript File ID',translation_file_id:'Translation File ID',summary_file_id:'Summary File ID',mom_file_id:'MoM File ID',word_file_id:'Word File ID',github_run_url:'GitHub Run URL'};
      if(map[k]&&d[k]) setByHeader_(sheet,MEETING_HEADERS,rowNo,map[k],String(d[k]));
    });
    logEvent_(meetingId,'COMPLETED','FINALIZATION',100,0,'Meeting processing completed','COMPLETED',d.github_run_id,d);
    rebuildAnalytics_();
    return {success:true,meeting_id:meetingId,status:'COMPLETED',processing_seconds:num_(getObjectAtRow_(sheet,MEETING_HEADERS,rowNo)['Processing Time Seconds'])};
  } finally { lock.releaseLock(); }
}
function failMeeting_(d) {
  const meetingId=clean_(d.meeting_id);
  if(!meetingId) throw new Error('meeting_id is required');
  const lock=LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sheet=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.MEETINGS);
    const rowNo=findRow_(sheet,'Meeting ID',meetingId);
    if(rowNo<2) throw new Error('Meeting not found.');
    const current=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);
    const currentStatus=String(current['Status']||'').toUpperCase();
    if(['COMPLETED','STOPPED','DELETED'].indexOf(currentStatus)>=0) {
      logEvent_(meetingId,'LATE_FAILURE_IGNORED','FINALIZATION',num_(d.progress_percent),0,'Ignored failure callback because meeting is already '+currentStatus,currentStatus,d.github_run_id,d);
      return {success:true,ignored:true,meeting_id:meetingId,status:currentStatus,reason:'TERMINAL_STATE'};
    }
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status',clean_(d.status)||'FAILED');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Current Stage',clean_(d.stage)||'FAILED');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Code',clean_(d.error_code));
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Message',clean_(d.error_message)||clean_(d.message));
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Recovery Status',clean_(d.recovery_status)||'ACTION_REQUIRED');
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());
    logEvent_(meetingId,'FAILED',clean_(d.stage)||'FAILED',num_(d.progress_percent),num_(d.eta_seconds),clean_(d.message)||'Processing failed','FAILED',d.github_run_id,d);
    rebuildAnalytics_();
    return {success:true,meeting_id:meetingId,status:'FAILED'};
  } finally { lock.releaseLock(); }
}
function updateReport_(d) {
  const meetingId=clean_(d.meeting_id);
  const reportType=clean_(d.report_type)||'MoM';
  const content=String(d.content||'');
  if(!meetingId || !content) throw new Error('meeting_id and content are required');

  const sheet=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.MEETINGS);
  const rowNo=findRow_(sheet,'Meeting ID',meetingId);
  if(rowNo<2) throw new Error('Meeting not found.');

  const row=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);
  const folderId=row['Reports Folder ID']||row['Meeting Folder ID'];
  const folder=DriveApp.getFolderById(folderId);
  const fileName=meetingId+'_'+reportType.replace(/[^\w-]+/g,'_')+'.txt';
  const files=folder.getFilesByName(fileName);
  let file;
  if(files.hasNext()) {
    file=files.next();
    file.setContent(content);
  } else {
    file=folder.createFile(fileName,content,MimeType.PLAIN_TEXT);
  }

  const map={
    transcript:'Transcript File ID',translation:'Translation File ID',
    summary:'Summary File ID',mom:'MoM File ID',executive_summary:'Summary File ID'
  };
  const key=map[reportType.toLowerCase()];
  if(key) setByHeader_(sheet,MEETING_HEADERS,rowNo,key,file.getId());
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());
  logEvent_(meetingId,'REPORT_UPDATED','REPORT',100,0,reportType+' saved to Drive','COMPLETED','',{});
  return {success:true,meeting_id:meetingId,report_type:reportType,file_id:file.getId(),url:file.getUrl()};
}

function recordChunk_(d) {
  const ss=SpreadsheetApp.openById(spreadsheetId_());
  const sheet=ss.getSheetByName(SHEETS.CHUNKS);
  const meetingId=clean_(d.meeting_id);
  const chunkNo=num_(d.chunk_no);
  if(!meetingId || !chunkNo) throw new Error('meeting_id and chunk_no are required');

  const id=meetingId+'-C'+String(chunkNo).padStart(4,'0');
  const existing=findRow_(sheet,'Chunk ID',id);
  const row={
    'Chunk ID':id,'Meeting ID':meetingId,'Recording Attempt':num_(d.recording_attempt)||1,
    'Chunk No':chunkNo,'Start Seconds':num_(d.start_seconds),'End Seconds':num_(d.end_seconds),
    'Duration Seconds':num_(d.duration_seconds),'Drive Chunk File ID':clean_(d.drive_chunk_file_id),
    'Transcript File ID':clean_(d.transcript_file_id),'Translation File ID':clean_(d.translation_file_id),
    'Summary File ID':clean_(d.summary_file_id),'Status':clean_(d.status)||'COMPLETED',
    'Attempt':num_(d.attempt)||1,'Processing Start':clean_(d.processing_start),
    'Processing End':clean_(d.processing_end),'Processing Seconds':num_(d.processing_seconds),
    'Error Code':clean_(d.error_code),'Error Message':clean_(d.error_message),'Updated At':new Date()
  };
  if(existing>1) updateObjectAtRow_(sheet,CHUNK_HEADERS,existing,row);
  else appendObject_(sheet,CHUNK_HEADERS,row);
  return {success:true,chunk_id:id};
}

/* =========================
 * GITHUB
 * ========================= */

function dispatchWorkflow_(payload) {
  const token=PropertiesService.getScriptProperties().getProperty(V2.GITHUB_TOKEN_PROPERTY);
  if(!token) return {success:false,message:'GITHUB_TOKEN is not configured in Apps Script Script Properties.'};

  const url='https://api.github.com/repos/'+V2.REPO+'/actions/workflows/'+encodeURIComponent(V2.WORKFLOW_FILE)+'/dispatches';
  const options={
    method:'post',
    contentType:'application/json',
    headers:{
      Authorization:'Bearer '+token,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'
    },
    payload:JSON.stringify({ref:V2.WORKFLOW_REF,inputs:{payload_json:JSON.stringify(payload)}}),
    muteHttpExceptions:true
  };

  const response=UrlFetchApp.fetch(url,options);
  const code=response.getResponseCode();
  const text=response.getContentText()||'';

  if(code<200 || code>=300) {
    return {success:false,http_status:code,message:githubError_(code,text)};
  }

  let data={};
  try { data=JSON.parse(text||'{}'); } catch(e) {}
  return {
    success:true,
    http_status:code,
    run_id:data.workflow_run_id||'',
    run_url:data.run_url||'',
    html_url:data.html_url||''
  };
}

function githubStatus_() {
  const token=PropertiesService.getScriptProperties().getProperty(V2.GITHUB_TOKEN_PROPERTY);
  if(!token) return {success:false,configured:false,message:'GitHub token missing.'};

  const repoUrl='https://api.github.com/repos/'+V2.REPO;
  const r=UrlFetchApp.fetch(repoUrl,{method:'get',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},muteHttpExceptions:true});
  const code=r.getResponseCode();
  if(code<200||code>=300) return {success:false,configured:true,http_status:code,message:githubError_(code,r.getContentText())};
  const repo=JSON.parse(r.getContentText()||'{}');

  const wf='https://api.github.com/repos/'+V2.REPO+'/actions/workflows/'+encodeURIComponent(V2.WORKFLOW_FILE);
  const w=UrlFetchApp.fetch(wf,{method:'get',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},muteHttpExceptions:true});
  const wc=w.getResponseCode();

  return {
    success:true,configured:true,repository:V2.REPO,private:!!repo.private,
    default_branch:repo.default_branch||'',
    workflow_exists:wc>=200&&wc<300,
    workflow_file:V2.WORKFLOW_FILE,
    workflow_http_status:wc
  };
}

function githubError_(code,text) {
  if(code===401) return 'GitHub rejected the token (401). Check the PAT.';
  if(code===403) return 'GitHub refused the request (403). Check token permissions.';
  if(code===404) return 'GitHub returned 404. Check repository/workflow access.';
  if(code===422) return 'GitHub rejected the workflow dispatch (422). Ensure workflow_dispatch and payload_json input exist.';
  return 'GitHub HTTP '+code+': '+String(text||'').slice(0,300);
}

/* =========================
 * ANALYTICS
 * ========================= */

function analytics_(p) {
  const meetings=readObjects_(SHEETS.MEETINGS,MEETING_HEADERS);
  const days=Math.max(7,Math.min(366,num_(p.days)||30));
  const start=new Date(Date.now()-days*86400000);
  const rows=meetings.filter(function(m){return toDate_(m['Created At'])>=start;});

  const byDay={};
  const byDevice={};
  const byStatus={};
  const byMonth={};

  rows.forEach(function(m){
    const d=dateKey_(m['Created At']);
    const month=String(d).slice(0,7);
    byDay[d]=(byDay[d]||0)+1;
    const dev=clean_(m['Device Type'])||'Unknown';
    byDevice[dev]=(byDevice[dev]||0)+1;
    const st=clean_(m['Status'])||'UNKNOWN';
    byStatus[st]=(byStatus[st]||0)+1;
    byMonth[month]=(byMonth[month]||0)+1;
  });

  return {success:true,days:days,total:rows.length,by_day:byDay,by_device:byDevice,by_status:byStatus,by_month:byMonth};
}

function rebuildAnalytics_() {
  const meetings=readObjects_(SHEETS.MEETINGS,MEETING_HEADERS);
  const daily={};
  const monthly={};

  meetings.forEach(function(m){
    const d=dateKey_(m['Created At']);
    if(!d) return;
    const mo=d.slice(0,7);
    if(!daily[d]) daily[d]=blankDaily_(d);
    if(!monthly[mo]) monthly[mo]=blankMonthly_(mo);
    accumulateAnalytics_(daily[d],m);
    accumulateAnalytics_(monthly[mo],m);
  });

  writeObjects_(SHEETS.DAILY,DAILY_HEADERS,Object.keys(daily).sort().map(function(k){return daily[k];}));
  writeObjects_(SHEETS.MONTHLY,MONTHLY_HEADERS,Object.keys(monthly).sort().map(function(k){return monthly[k];}));
}

function blankDaily_(d) {
  const o={}; DAILY_HEADERS.forEach(function(h){o[h]='';}); o['Date']=d; return o;
}
function blankMonthly_(m) {
  const o={}; MONTHLY_HEADERS.forEach(function(h){o[h]='';}); o['Month']=m; return o;
}

function accumulateAnalytics_(o,m) {
  const status=String(m['Status']||'').toUpperCase();
  o['Meetings Started']=num_(o['Meetings Started'])+1;
  if(status==='COMPLETED') o['Meetings Completed']=num_(o['Meetings Completed'])+1;
  if(status==='FAILED') o['Meetings Failed']=num_(o['Meetings Failed'])+1;
  if(status==='STOPPED') o['Meetings Stopped']=num_(o['Meetings Stopped'])+1;
  if(String(m['Redo Required']).toUpperCase()==='YES') o['Meetings Redo']=num_(o['Meetings Redo'])+1;
  if(num_(m['Recording Attempt'])>1) o['Meetings Reprocessed']=num_(o['Meetings Reprocessed'])+1;
  if(String(m['First Pass Success']).toUpperCase()==='YES') o['First Pass Success']=num_(o['First Pass Success'])+1;
  o['Total Meeting Minutes']=num_(o['Total Meeting Minutes'])+num_(m['Meeting Duration Minutes']);
  o['Total Audio Minutes']=num_(o['Total Audio Minutes'])+num_(m['Audio Duration Minutes']);
  o['Total Processing Seconds']=num_(o['Total Processing Seconds'])+num_(m['Processing Time Seconds']);

  const n=num_(o['Meetings Started'])||1;
  o['Average Meeting Minutes']=round_(num_(o['Total Meeting Minutes'])/n,2);
  o['Average Audio Minutes']=round_(num_(o['Total Audio Minutes'])/n,2);
  o['Average Processing Seconds']=round_(num_(o['Total Processing Seconds'])/n,2);
  o['Success Rate Percent']=round_(100*num_(o['Meetings Completed'])/n,2);
  o['First Pass Success Percent']=round_(100*num_(o['First Pass Success'])/n,2);
}



/* Recovery controls exposed to the History tab. */
function rerunMeeting(meetingId) {
  meetingId=clean_(meetingId);
  if(!meetingId) return {success:false,message:'Meeting ID is required.'};
  const sheet=getRegistrySheet_();
  const rowNo=findRow_(sheet,'Meeting ID',meetingId);
  if(rowNo<2) return {success:false,message:'Meeting not found.'};
  const row=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);
  if(String(row['Status']).toUpperCase()==='DELETED') return {success:false,message:'This meeting is deleted from history.'};
  if(!clean_(row['Audio File ID'])) return {success:false,message:'Cannot rerun: the source audio file ID is missing.'};

  const attempt=num_(row['Recording Attempt'])||1;
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Recording Attempt',attempt+1);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Retry Count',num_(row['Retry Count'])+1);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Resume Count',num_(row['Resume Count'])+1);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Workflow Attempt',num_(row['Workflow Attempt'])+1);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Code','');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Error Message','');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Processing End','');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Completed At','');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Recovery Status','RETRYING');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());

  const result=startProcessing_({
    meeting_id:meetingId,
    audio_file_id:row['Audio File ID'],
    audio_folder_id:row['Audio Folder ID'],
    meeting_folder_id:row['Meeting Folder ID'],
    processing_folder_id:row['Processing Folder ID'],
    meeting_title:row['Meeting Title'],
    meeting_date:row['Meeting Date'],
    start_time:row['Start Time'],
    end_time:row['End Time'],
    venue:row['Venue'],
    agenda:row['Agenda'],
    participants:row['Participants'],
    processing_mode:'retry'
  });
  if(!result.success) {
    setByHeader_(sheet,MEETING_HEADERS,rowNo,'Recovery Status','RETRY_FAILED');
    return result;
  }
  logEvent_(meetingId,'MANUAL_RERUN','RECOVERY',5,0,'Manual rerun dispatched from Meeting History','QUEUED',result.github&&result.github.run_id,{});
  return {success:true,meeting_id:meetingId,message:'Rerun queued.',github:result.github||{}};
}

function stopMeeting(meetingId) {
  meetingId=clean_(meetingId);
  if(!meetingId) return {success:false,message:'Meeting ID is required.'};
  const sheet=getRegistrySheet_();
  const rowNo=findRow_(sheet,'Meeting ID',meetingId);
  if(rowNo<2) return {success:false,message:'Meeting not found.'};
  const row=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);
  if(String(row['Status']).toUpperCase()==='DELETED') return {success:false,message:'This meeting is deleted from history.'};
  let cancelResult={success:false,message:'No GitHub run ID is recorded; marked stopped in the registry only.'};
  const runId=clean_(row['GitHub Run ID']);
  if(runId) cancelResult=cancelWorkflowRun_(runId);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status','STOPPED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Current Stage','STOPPED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'ETA Seconds',0);
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Recovery Status',cancelResult.success?'STOPPED':'STOP_REQUESTED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Stopped By','Meeting History');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());
  logEvent_(meetingId,'MANUAL_STOP','STOPPED',num_(row['Overall Percent']),0,cancelResult.message,'STOPPED',runId,{});
  return {success:true,meeting_id:meetingId,cancelled:!!cancelResult.success,message:cancelResult.message};
}

function cancelWorkflowRun_(runId) {
  const token=PropertiesService.getScriptProperties().getProperty(V2.GITHUB_TOKEN_PROPERTY);
  if(!token) return {success:false,message:'GitHub token is not configured.'};
  const url='https://api.github.com/repos/'+V2.REPO+'/actions/runs/'+encodeURIComponent(runId)+'/cancel';
  const r=UrlFetchApp.fetch(url,{method:'post',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},muteHttpExceptions:true});
  const code=r.getResponseCode();
  return code>=200&&code<300?{success:true,message:'GitHub cancellation requested.'}:{success:false,message:'GitHub cancellation failed (HTTP '+code+'). '+String(r.getContentText()||'').slice(0,180)};
}

function deleteMeeting(meetingId) {
  meetingId=clean_(meetingId);
  if(!meetingId) return {success:false,message:'Meeting ID is required.'};
  const sheet=getRegistrySheet_();
  const rowNo=findRow_(sheet,'Meeting ID',meetingId);
  if(rowNo<2) return {success:false,message:'Meeting not found.'};
  const row=getObjectAtRow_(sheet,MEETING_HEADERS,rowNo);
  if(String(row['Status']).toUpperCase()==='DELETED') return {success:true,meeting_id:meetingId,message:'Already removed from history.'};
  const status=String(row['Status']||'').toUpperCase();
  if(status==='PROCESSING'||status==='QUEUED') {
    const stop=stopMeeting(meetingId);
    if(!stop.success) return stop;
  }
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Status','DELETED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Current Stage','DELETED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Recovery Status','SOFT_DELETED');
  setByHeader_(sheet,MEETING_HEADERS,rowNo,'Updated At',new Date());
  logEvent_(meetingId,'MEETING_HIDDEN','HISTORY',num_(row['Overall Percent']),0,'Meeting hidden from History; Drive files retained for recovery.','DELETED',row['GitHub Run ID'],{});
  return {success:true,meeting_id:meetingId,message:'Meeting removed from History. Drive files were retained.'};
}

/* Public server functions callable from the HTML dashboard. */
function getDashboard() { return dashboard_(); }
function getMeetings(p) { return listMeetings_(p || {}); }
function getAnalytics(p) { return analytics_(p || {}); }
function getGitHubStatus() { return githubStatus_(); }
function getSetupStatus() { return setupStatus_(); }
function getMeeting(id) { return getMeeting_(id); }

/* =========================
 * DATA HELPERS
 * ========================= */

function getMeeting_(id) {
  id=clean_(id);
  if(!id) return {success:false,error:'MEETING_ID_REQUIRED'};
  const sheet=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.MEETINGS);
  const row=findRow_(sheet,'Meeting ID',id);
  if(row<2) return {success:false,error:'NOT_FOUND',meeting_id:id};
  return {success:true,meeting:publicMeeting_(getObjectAtRow_(sheet,MEETING_HEADERS,row))};
}

function listMeetings_(p) {
  let rows=readObjects_(SHEETS.MEETINGS,MEETING_HEADERS);
  if(String(p.include_deleted||'').toLowerCase()!=='true') rows=rows.filter(function(m){return String(m['Status']||'').toUpperCase()!=='DELETED';});
  const q=String(p.search||'').toLowerCase().trim();
  const status=String(p.status||'').toLowerCase().trim();
  if(q) rows=rows.filter(function(m){return JSON.stringify(m).toLowerCase().indexOf(q)>=0;});
  if(status) rows=rows.filter(function(m){return String(m['Status']||'').toLowerCase()===status;});
  rows=rows.slice(-Math.min(500,num_(p.limit)||100)).reverse();
  return {success:true,total:rows.length,meetings:rows.map(publicMeeting_)};
}

function getEvents_(id) {
  return {success:true,meeting_id:id,events:readObjects_(SHEETS.EVENTS,EVENT_HEADERS).filter(function(e){return e['Meeting ID']===id;})};
}
function getChunks_(id) {
  return {success:true,meeting_id:id,chunks:readObjects_(SHEETS.CHUNKS,CHUNK_HEADERS).filter(function(e){return e['Meeting ID']===id;})};
}

function publicMeeting_(m) {
  const out={};
  MEETING_HEADERS.forEach(function(h){out[snake_(h)]=serialize_(m[h]);});
  return out;
}

function setupStatus_() {
  const ss=SpreadsheetApp.openById(spreadsheetId_());
  return {
    success:true,
    spreadsheet_exists:true,
    sheets:Object.keys(SHEETS).map(function(k){return {name:SHEETS[k],exists:!!ss.getSheetByName(SHEETS[k])};}),
    root_folder_id:PropertiesService.getScriptProperties().getProperty(V2.ROOT_FOLDER_PROPERTY)||'',
    github_token_configured:!!PropertiesService.getScriptProperties().getProperty(V2.GITHUB_TOKEN_PROPERTY),
    callback_secret_configured:!!PropertiesService.getScriptProperties().getProperty(V2.CALLBACK_SECRET_PROPERTY)
  };
}

function health_() {
  return {
    success:true,service:'Meeting online V2 Private Control Tower',
    status:'OK',version:V2.VERSION,
    spreadsheet_configured:!!PropertiesService.getScriptProperties().getProperty(V2.SPREADSHEET_ID_PROPERTY),
    github_repo:V2.REPO,
    workflow:V2.WORKFLOW_FILE,
    capabilities:[
      'private_dashboard','meeting_registry','event_log','chunk_registry',
      'analytics_daily','analytics_monthly','github_workflow_dispatch',
      'github_run_capture','recovery_metadata','report_editing'
    ],
    timestamp:now_()
  };
}

function getRegistrySheet_() {
  return SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.MEETINGS);
}

function spreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty(V2.SPREADSHEET_ID_PROPERTY);
  if (!id) throw new Error('Missing Script Property MMV2_SPREADSHEET_ID. Add the registry spreadsheet ID in Project Settings > Script properties.');
  return id.trim();
}

function ensureSheet_(ss,name,headers) {
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  if(sh.getLastRow()===0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  else {
    const existing=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),headers.length)).getValues()[0];
    const current=existing.filter(function(x){return x!=='';});
    if(current.length===0) sh.getRange(1,1,1,headers.length).setValues([headers]);
    else {
      headers.forEach(function(h,i){if(existing[i]!==h) sh.getRange(1,i+1).setValue(h);});
    }
  }
  sh.setFrozenRows(1);
  return sh;
}

function formatAllSheets_() {
  const ss=SpreadsheetApp.openById(spreadsheetId_());
  Object.keys(SHEETS).forEach(function(k){
    const sh=ss.getSheetByName(SHEETS[k]);
    if(!sh)return;
    sh.setFrozenRows(1);
    if(sh.getLastColumn()>0) sh.autoResizeColumns(1,Math.min(sh.getLastColumn(),20));
  });
}

function formatRegistrySheet_(sh) {
  sh.setFrozenRows(1);
  sh.getRange(1,1,1,sh.getLastColumn()).setFontWeight('bold');
}

function appendObject_(sheet,headers,obj) {
  sheet.appendRow(headers.map(function(h){return obj[h]===undefined?'':obj[h];}));
}

function updateObjectAtRow_(sheet,headers,row,obj) {
  const values=sheet.getRange(row,1,1,headers.length).getValues()[0];
  headers.forEach(function(h,i){if(obj[h]!==undefined)values[i]=obj[h];});
  sheet.getRange(row,1,1,headers.length).setValues([values]);
}

function setByHeader_(sheet,headers,row,header,value) {
  const i=headers.indexOf(header);
  if(i>=0) sheet.getRange(row,i+1).setValue(value);
}

function getObjectAtRow_(sheet,headers,row) {
  const values=sheet.getRange(row,1,1,headers.length).getValues()[0];
  const o={}; headers.forEach(function(h,i){o[h]=values[i];}); return o;
}

function readObjects_(sheetName,headers) {
  const sh=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(sheetName);
  if(!sh || sh.getLastRow()<2) return [];
  const values=sh.getRange(2,1,sh.getLastRow()-1,headers.length).getValues();
  return values.map(function(r){const o={};headers.forEach(function(h,i){o[h]=r[i];});return o;});
}

function writeObjects_(sheetName,headers,objects) {
  const sh=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(sheetName);
  const last=sh.getLastRow();
  if(last>1) sh.getRange(2,1,last-1,Math.max(sh.getLastColumn(),headers.length)).clearContent();
  if(objects.length) sh.getRange(2,1,objects.length,headers.length).setValues(objects.map(function(o){return headers.map(function(h){return o[h]===undefined?'':o[h];});}));
}

function findRow_(sheet,header,value) {
  if(sheet.getLastRow()<2) return -1;
  const col=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].indexOf(header)+1;
  if(col<1)return -1;
  const vals=sheet.getRange(2,col,sheet.getLastRow()-1,1).getValues();
  for(let i=0;i<vals.length;i++) if(String(vals[i][0])===String(value)) return i+2;
  return -1;
}

function logEvent_(meetingId,event,stage,pct,eta,message,status,runId,metadata) {
  const sh=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.EVENTS);
  const o={
    'Event ID':Utilities.getUuid(),
    'Timestamp':new Date(),'Meeting ID':meetingId,
    'Recording Attempt':num_(metadata&&metadata.recording_attempt)||1,
    'Event':event,'Stage':stage,'Progress Percent':pct,'ETA Seconds':eta,
    'Chunk No':metadata&&metadata.chunk_no?metadata.chunk_no:'',
    'Message':message,'Status':status,'GitHub Run ID':runId||'',
    'GitHub Run Number':metadata&&metadata.github_run_number?metadata.github_run_number:'',
    'Workflow Attempt':metadata&&metadata.github_run_attempt?metadata.github_run_attempt:'',
    'Device':metadata&&metadata.device_type?metadata.device_type:'',
    'Processing Seconds':metadata&&metadata.processing_seconds?metadata.processing_seconds:'',
    'Metadata JSON':JSON.stringify(metadata||{})
  };
  appendObject_(sh,EVENT_HEADERS,o);
}

function writeConfig_(key,value,sensitive) {
  const sh=SpreadsheetApp.openById(spreadsheetId_()).getSheetByName(SHEETS.CONFIG);
  const row=findRow_(sh,'Key',key);
  const values=[key,sensitive?'[STORED AS SCRIPT PROPERTY]':value,sensitive?'YES':'NO',new Date()];
  if(row>1) sh.getRange(row,1,1,4).setValues([values]); else sh.appendRow(values);
}

function getOrCreateFolder_(property,name) {
  const props=PropertiesService.getScriptProperties();
  const id=props.getProperty(property);
  if(id) {
    try{return DriveApp.getFolderById(id);}catch(e){}
  }
  const folder=DriveApp.createFolder(name);
  props.setProperty(property,folder.getId());
  return folder;
}

function getOrCreateChildFolder_(parent,property,name) {
  const props=PropertiesService.getScriptProperties();
  const id=props.getProperty(property);
  if(id){try{return DriveApp.getFolderById(id);}catch(e){}}
  const it=parent.getFoldersByName(name);
  const folder=it.hasNext()?it.next():parent.createFolder(name);
  props.setProperty(property,folder.getId());
  return folder;
}

function generateMeetingId_() {
  return 'MM-' + Utilities.formatDate(new Date(),V2.TIMEZONE,'yyyyMMdd-HHmmss') + '-' +
    Utilities.getUuid().replace(/-/g,'').slice(0,6).toUpperCase();
}

function parseBody_(e) {
  if(!e) return {};
  const raw=e.postData&&e.postData.contents?e.postData.contents:'';
  if(!raw)return e.parameter||{};
  try{return JSON.parse(raw);}catch(err){return e.parameter||{};}
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function dashboardHtml_() {
  return HtmlService.createHtmlOutput("<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><title>Meeting online V2</title><style>\n*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:#18212b;font-family:Arial,sans-serif}header{background:#17212b;color:#fff;padding:17px 18px;position:sticky;top:0;z-index:10}header h1{margin:0;font-size:21px}header p{margin:5px 0 0;font-size:12px;opacity:.75}main{max-width:1050px;margin:auto;padding:12px}.tabs{display:flex;gap:7px;overflow:auto;margin-bottom:12px}.tabs button{border:1px solid #dce2e8;background:#fff;border-radius:20px;padding:10px 14px;white-space:nowrap;font-weight:700}.tabs button.active{background:#17212b;color:#fff}.card{background:#fff;border:1px solid #e1e6eb;border-radius:14px;padding:15px;margin-bottom:12px;box-shadow:0 2px 7px #0000000a}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}label{display:block;font-size:12px;color:#66717d;margin:0 0 5px}input,textarea{width:100%;padding:11px;border:1px solid #ccd4dc;border-radius:9px;background:#fff;font:inherit}textarea{min-height:76px;resize:vertical}.full{grid-column:1/-1}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{border:0;border-radius:10px;padding:11px 14px;font-weight:700;cursor:pointer}.primary{background:#17212b;color:#fff}.secondary{background:#e9edf1;color:#18212b}.danger{background:#b91c1c;color:#fff}button:disabled{opacity:.45;cursor:not-allowed}.recordbox{border:1px solid #dfe5ea;border-radius:12px;padding:12px;background:#fafbfc}.timer{font-size:31px;font-weight:800;font-variant-numeric:tabular-nums}.recordstate{font-size:12px;color:#66717d;margin-top:4px}.progress{height:13px;background:#e7ecf0;border-radius:20px;overflow:hidden;margin:11px 0}.progress i{display:block;height:100%;width:0;background:#2563eb;transition:width .35s}.status{display:flex;align-items:center;gap:8px;font-weight:700}.dot{width:10px;height:10px;border-radius:50%;background:#94a3b8}.dot.ok{background:#15803d}.dot.warn{background:#b45309}.dot.bad{background:#b91c1c}.big{font-size:29px;font-weight:800;margin-top:8px}.muted{color:#66717d;font-size:12px}.ids{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.idbox{background:#f7f9fb;border:1px solid #e1e6eb;border-radius:9px;padding:9px}.idbox b{display:block;font-size:10px;color:#66717d;margin-bottom:4px}.idbox span{font-size:12px;word-break:break-all}.hidden{display:none!important}.tablewrap{overflow:auto}.rowactions{display:flex;gap:5px;flex-wrap:wrap}.rowactions button{padding:7px 9px;font-size:11px}.rowactions .mini-danger{background:#b91c1c;color:#fff}.rowactions .mini-primary{background:#17212b;color:#fff}.rowactions .mini-secondary{background:#e9edf1;color:#18212b}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #edf0f2;font-size:12px;text-align:left;white-space:nowrap}.notice{padding:10px;border-radius:9px;background:#f5f7f9;font-size:12px}.oktext{color:#15803d}.badtext{color:#b91c1c}#log{max-height:230px;overflow:auto;background:#10151b;color:#d8dee6;border-radius:9px;padding:10px;font:12px/1.5 Consolas,monospace;white-space:pre-wrap}\n@media(max-width:650px){.grid,.ids{grid-template-columns:1fr}.full{grid-column:auto}.big{font-size:25px}}\n</style></head><body>\n<header><h1>Meeting online V2</h1><p>Private Control Tower \u2022 Record / Select \u2192 Drive \u2192 GitHub \u2192 MoM</p></header>\n<main><div class=\"tabs\"><button class=\"active\" onclick=\"tab('new',this)\">New Meeting</button><button onclick=\"tab('dashboard',this)\">Dashboard</button><button onclick=\"tab('history',this)\">History</button><button onclick=\"tab('system',this)\">System</button></div>\n<section id=\"new\">\n<form id=\"meetingForm\" onsubmit=\"submitMeeting(event)\"><div class=\"card\"><h2>Meeting Details</h2><div class=\"grid\">\n<div><label>Meeting title</label><input name=\"meeting_title\" required placeholder=\"Daily Operations Meeting\"></div>\n<div><label>Meeting date</label><input name=\"meeting_date\" type=\"date\"></div>\n<div><label>Start time</label><input name=\"start_time\" type=\"time\"></div>\n<div><label>End time</label><input name=\"end_time\" type=\"time\"></div>\n<div><label>Venue / Mode</label><input name=\"venue\" placeholder=\"Office / Online / Client\"></div>\n<div><label>Participants</label><input name=\"participants\" placeholder=\"Names and designations\"></div>\n<div class=\"full\"><label>Agenda</label><textarea name=\"agenda\" placeholder=\"Agenda / purpose of meeting\"></textarea></div>\n</div></div>\n<div class=\"card\"><h2>Audio Recording</h2><div class=\"recordbox\"><div class=\"timer\" id=\"timer\">00:00</div><div class=\"recordstate\" id=\"recordState\">Ready to record</div><div class=\"actions\"><button type=\"button\" class=\"primary\" id=\"recordBtn\" onclick=\"startRecord()\">Start Recording</button><button type=\"button\" class=\"secondary\" id=\"pauseBtn\" onclick=\"pauseRecord()\" disabled>Pause</button><button type=\"button\" class=\"secondary\" id=\"resumeBtn\" onclick=\"resumeRecord()\" disabled>Resume</button><button type=\"button\" class=\"danger\" id=\"stopBtn\" onclick=\"stopRecord()\" disabled>Stop &amp; Process</button><button type=\"button\" class=\"secondary\" id=\"rerecordBtn\" onclick=\"resetRecording()\" disabled>Re-record</button></div></div>\n<div style=\"height:10px\"></div><label>Or select an existing recording</label><input id=\"audioInput\" name=\"audio\" type=\"file\" accept=\"audio/*\"><div class=\"muted\" style=\"margin-top:5px\">No Drive ID is required. The system creates the Meeting ID and Audio File ID automatically.</div>\n<div class=\"actions\"><button id=\"startBtn\" class=\"primary\" type=\"submit\">Upload &amp; Start Processing</button><button class=\"secondary\" type=\"button\" onclick=\"clearForm()\">Clear</button></div></div></form>\n<div id=\"liveCard\" class=\"card hidden\"><div class=\"status\"><span id=\"statusDot\" class=\"dot\"></span><span id=\"statusText\">Preparing...</span></div><div class=\"big\" id=\"percent\">0%</div><div class=\"progress\"><i id=\"progressBar\"></i></div><div id=\"stage\" class=\"muted\">Waiting...</div><div id=\"eta\" class=\"muted\"></div></div>\n<div id=\"resultCard\" class=\"card hidden\"><h2>Control Tower</h2><div id=\"resultText\" class=\"notice\"></div><div style=\"height:10px\"></div><div class=\"ids\" id=\"ids\"></div></div>\n<div id=\"logCard\" class=\"card hidden\"><h2>Live Log</h2><div id=\"log\"></div></div>\n</section>\n<section id=\"dashboard\" class=\"hidden\"><div class=\"card\"><h2>Dashboard</h2><div id=\"dash\"></div></div></section>\n<section id=\"history\" class=\"hidden\"><div class=\"card\"><h2>Meeting History</h2><div class=\"tablewrap\"><table><thead><tr><th>Meeting</th><th>Status</th><th>Stage</th><th>%</th><th>Run</th><th>Actions</th></tr></thead><tbody id=\"historyRows\"></tbody></table></div></div></section>\n<section id=\"system\" class=\"hidden\"><div class=\"card\"><h2>System</h2><div id=\"systemInfo\"></div></div></section>\n</main>\n<script>\nvar mediaRecorder=null,recordedChunks=[],recordTimer=null,recordStartedAt=0,elapsed=0,currentMeetingId='',currentMeeting=null;\nfunction $(id){return document.getElementById(id)}\nfunction tab(id,b){document.querySelectorAll('main>section').forEach(function(x){x.classList.add('hidden')});$(id).classList.remove('hidden');document.querySelectorAll('.tabs button').forEach(function(x){x.classList.remove('active')});b.classList.add('active');if(id==='dashboard')loadDashboard();if(id==='history')loadHistory();if(id==='system')loadSystem()}\nfunction log(s){$('logCard').classList.remove('hidden');$('log').textContent+=(new Date()).toLocaleTimeString()+'  '+s+'\\n';$('log').scrollTop=$('log').scrollHeight}\nfunction setRecordState(s){$('recordState').textContent=s}\nfunction fmt(sec){sec=Math.max(0,Math.floor(sec));return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0')}\nfunction tick(){elapsed=Math.floor((Date.now()-recordStartedAt)/1000);$('timer').textContent=fmt(elapsed)}\nfunction startRecord(){if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){alert('This browser does not provide microphone recording. Use the audio-file selector instead.');return}navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){recordedChunks=[];mediaRecorder=new MediaRecorder(stream);mediaRecorder.ondataavailable=function(e){if(e.data&&e.data.size)recordedChunks.push(e.data)};mediaRecorder.onstop=function(){stream.getTracks().forEach(function(t){t.stop()});var blob=new Blob(recordedChunks,{type:mediaRecorder.mimeType||'audio/webm'});var ext=(blob.type.indexOf('ogg')>=0?'ogg':blob.type.indexOf('mp4')>=0?'m4a':'webm');var file=new File([blob],'meeting-recording-'+Date.now()+'.'+ext,{type:blob.type||'audio/webm'});try{var dt=new DataTransfer();dt.items.add(file);$('audioInput').files=dt.files}catch(e){}setRecordState('Recording captured: '+(blob.size/1024/1024).toFixed(2)+' MB');$('rerecordBtn').disabled=false;$('recordBtn').disabled=false;$('startBtn').disabled=false;log('Recording captured. Ready to upload.');submitMeeting();};mediaRecorder.start(1000);recordStartedAt=Date.now();elapsed=0;tick();recordTimer=setInterval(tick,500);$('recordBtn').disabled=true;$('pauseBtn').disabled=false;$('resumeBtn').disabled=true;$('stopBtn').disabled=false;setRecordState('Recording...');log('Microphone recording started.');}).catch(function(e){alert('Microphone permission failed: '+(e.message||e));})}\nfunction pauseRecord(){if(mediaRecorder&&mediaRecorder.state==='recording'){mediaRecorder.pause();clearInterval(recordTimer);$('pauseBtn').disabled=true;$('resumeBtn').disabled=false;setRecordState('Paused')}}\nfunction resumeRecord(){if(mediaRecorder&&mediaRecorder.state==='paused'){mediaRecorder.resume();recordStartedAt=Date.now()-elapsed*1000;recordTimer=setInterval(tick,500);$('pauseBtn').disabled=false;$('resumeBtn').disabled=true;setRecordState('Recording...')}}\nfunction stopRecord(){if(mediaRecorder&&mediaRecorder.state!=='inactive'){mediaRecorder.stop();clearInterval(recordTimer);$('stopBtn').disabled=true;$('pauseBtn').disabled=true;$('resumeBtn').disabled=true;setRecordState('Finishing recording...')}}\nfunction resetRecording(){if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();clearInterval(recordTimer);mediaRecorder=null;recordedChunks=[];elapsed=0;$('timer').textContent='00:00';$('audioInput').value='';$('recordBtn').disabled=false;$('pauseBtn').disabled=true;$('resumeBtn').disabled=true;$('stopBtn').disabled=true;$('rerecordBtn').disabled=true;$('startBtn').disabled=false;setRecordState('Ready to record');log('Recording reset.')}\nfunction submitMeeting(ev){if(ev&&ev.preventDefault)ev.preventDefault();var input=$('audioInput');if(!input.files||!input.files.length){if(ev)alert('Please record a meeting or select an audio file first.');return}if($('startBtn').disabled)return;$('startBtn').disabled=true;$('liveCard').classList.remove('hidden');$('resultCard').classList.add('hidden');$('percent').textContent='1%';$('progressBar').style.width='1%';$('statusText').textContent='Uploading recording...';$('stage').textContent='Creating meeting, uploading audio and preparing GitHub dispatch...';$('statusDot').className='dot warn';log('Uploading '+input.files[0].name+' ('+(input.files[0].size/1024/1024).toFixed(2)+' MB).');google.script.run.withSuccessHandler(function(r){if(!r||!r.success){$('startBtn').disabled=false;$('statusDot').className='dot bad';$('statusText').textContent='Upload/dispatch failed';log('ERROR: '+((r&&r.message)||'Unknown server error'));return}currentMeetingId=r.meeting_id;currentMeeting=r;$('percent').textContent=(r.progress_percent||5)+'%';$('progressBar').style.width=(r.progress_percent||5)+'%';$('statusDot').className='dot ok';$('statusText').textContent='GitHub processing queued';$('stage').textContent='Meeting registered and workflow dispatched';$('resultCard').classList.remove('hidden');$('resultText').textContent='Automatic pipeline is active. The Control Tower will update this screen.';$('ids').innerHTML='<div class=\"idbox\"><b>MEETING ID</b><span>'+r.meeting_id+'</span></div><div class=\"idbox\"><b>AUDIO FILE ID</b><span>'+r.audio_file_id+'</span></div><div class=\"idbox\"><b>MEETING FOLDER ID</b><span>'+r.meeting_folder_id+'</span></div><div class=\"idbox\"><b>GITHUB RUN</b><span>'+((r.github&&r.github.run_id)||'Queued \u2014 GitHub will assign the run ID')+'</span></div>';log('Meeting ID created: '+r.meeting_id);log('Audio File ID created: '+r.audio_file_id);log('GitHub dispatch accepted.');poll();}).withFailureHandler(function(e){$('startBtn').disabled=false;$('statusDot').className='dot bad';$('statusText').textContent='Server error';log('ERROR: '+(e.message||e));}).uploadAndStartMeeting(document.getElementById('meetingForm'))}\nfunction poll(){if(!currentMeetingId)return;google.script.run.withSuccessHandler(function(r){if(!r||!r.success)return;var m=r.meeting;var p=Number(m.overall_percent||0);$('percent').textContent=p+'%';$('progressBar').style.width=p+'%';$('statusText').textContent=m.status||'PROCESSING';$('stage').textContent=m.current_stage||'PROCESSING';$('eta').textContent=m.eta_seconds?'ETA: '+fmt(m.eta_seconds):'';$('statusDot').className='dot '+(m.status==='FAILED'?'bad':m.status==='COMPLETED'?'ok':'warn');if(m.error_message)log('ERROR: '+m.error_message);if(m.github_run_id)log('GitHub run: '+m.github_run_id);if(m.status==='COMPLETED'){log('MoM processing completed.');$('startBtn').disabled=false;return}if(m.status==='FAILED'){log('Processing failed. Check the GitHub run and error message.');$('startBtn').disabled=false;return}setTimeout(poll,5000)}).withFailureHandler(function(e){log('Status poll error: '+(e.message||e));setTimeout(poll,7000)}).getMeeting(currentMeetingId)}\nfunction loadDashboard(){google.script.run.withSuccessHandler(function(d){if(!d||!d.success)return;var t=d.today,w=d.week,m=d.month;$('dash').innerHTML='<b>Today:</b> '+t.total+' &nbsp; <b>This week:</b> '+w.total+' &nbsp; <b>This month:</b> '+m.total+'<br><br><b>Completed:</b> '+m.completed+' &nbsp; <b>Failed:</b> '+m.failed+' &nbsp; <b>Success:</b> '+m.success_rate_percent+'% &nbsp; <b>Processing:</b> '+t.processing;}).getDashboard()}\nfunction loadHistory(){
  google.script.run.withSuccessHandler(function(d){
    var meetings=(d&&d.meetings)||[];
    $('historyRows').innerHTML=meetings.map(function(x){
      var id=String(x.meeting_id||'');
      var safe=id.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      var st=String(x.status||'').toUpperCase();
      var disabled=st==='DELETED';
      var stopDisabled=disabled||st==='COMPLETED'||st==='FAILED'||st==='STOPPED';
      return '<tr><td>'+safe+'</td><td>'+st+'</td><td>'+String(x.current_stage||'')+'</td><td>'+Number(x.overall_percent||0)+'%</td><td>'+(x.github_run_number||x.github_run_id||'—')+'</td><td><div class="rowactions">'+
        '<button type="button" class="mini-primary history-action" data-action="rerun" data-meeting-id="'+safe+'" '+(disabled?'disabled':'')+'>Re-run</button>'+
        '<button type="button" class="mini-secondary history-action" data-action="stop" data-meeting-id="'+safe+'" '+(stopDisabled?'disabled':'')+'>Stop</button>'+
        '<button type="button" class="mini-danger history-action" data-action="delete" data-meeting-id="'+safe+'" '+(disabled?'disabled':'')+'>Delete</button>'+
        '</div></td></tr>';
    }).join('')||'<tr><td colspan="6">No meetings in history.</td></tr>';
    Array.prototype.forEach.call(document.querySelectorAll('.history-action'),function(button){
      button.addEventListener('click',function(){
        historyAction(button.getAttribute('data-action'),button.getAttribute('data-meeting-id'));
      });
    });
  }).withFailureHandler(function(e){
    alert('Unable to load meeting history: '+(e.message||e));
  }).getMeetings({limit:100});
}
function historyAction(action,id){var promptText=action==='rerun'?'Re-run processing for '+id+'?':action==='stop'?'Stop processing for '+id+'?':'Remove '+id+' from History? Its Google Drive files will be retained.';if(!confirm(promptText))return;var call=google.script.run.withSuccessHandler(function(r){if(!r||!r.success){alert((r&&r.message)||'Action failed.');return}alert(r.message||'Action completed.');loadHistory();}).withFailureHandler(function(e){alert('Action failed: '+(e.message||e));});if(action==='rerun')call.rerunMeeting(id);else if(action==='stop')call.stopMeeting(id);else if(action==='delete')call.deleteMeeting(id);else alert('Unknown action: '+action);}
function loadSystem(){google.script.run.withSuccessHandler(function(g){google.script.run.withSuccessHandler(function(s){$('systemInfo').innerHTML='<div class=\"notice\"><b>Gateway:</b> OK<br><b>GitHub:</b> '+(g.configured?'Connected':'Not configured')+'<br><b>Workflow:</b> '+(g.workflow_exists?'Available':'Not found')+'<br><b>Spreadsheet:</b> '+(s.spreadsheet_exists?'Available':'Not found')+'<br><b>Root Drive:</b> '+(s.root_folder_id?'Configured':'Not configured')+'</div>'}).getSetupStatus()}).getGitHubStatus()}\nfunction clearForm(){$('meetingForm').reset();resetRecording();$('liveCard').classList.add('hidden');$('resultCard').classList.add('hidden');$('logCard').classList.add('hidden');$('log').textContent='';currentMeetingId=''}\nloadDashboard();\n</script></body></html>\n").setTitle('Meeting online V2 — Private Control Tower');
}

/* =========================
 * UTILITIES
 * ========================= */

function breakdown_(rows,field) {
  const o={};
  rows.forEach(function(r){const k=clean_(r[field])||'Unknown';o[k]=(o[k]||0)+1;});
  return o;
}

function now_(){return Utilities.formatDate(new Date(),V2.TIMEZONE,"yyyy-MM-dd HH:mm:ss");}
function formatDate_(d){return Utilities.formatDate(new Date(d),V2.TIMEZONE,"yyyy-MM-dd");}
function formatTime_(d){return Utilities.formatDate(new Date(d),V2.TIMEZONE,"HH:mm:ss");}
function dateKey_(v){const d=toDate_(v);return d?Utilities.formatDate(d,V2.TIMEZONE,"yyyy-MM-dd"):'';}
function toDate_(v){if(!v)return new Date(0);if(v instanceof Date)return v;const d=new Date(v);return isNaN(d.getTime())?new Date(0):d;}
function startOfWeek_(d){const x=new Date(d);const day=x.getDay();const diff=(day+6)%7;x.setHours(0,0,0,0);x.setDate(x.getDate()-diff);return x;}
function clean_(v){return String(v===undefined||v===null?'':v).trim();}
function num_(v){const n=Number(v);return isFinite(n)?n:0;}
function round_(n,d){const p=Math.pow(10,d||0);return Math.round(n*p)/p;}
function serialize_(v){return v instanceof Date?Utilities.formatDate(v,V2.TIMEZONE,"yyyy-MM-dd HH:mm:ss"):v;}
function snake_(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');}
function mask_(s){s=String(s||'');return s.length<8?'********':s.slice(0,4)+'••••••••'+s.slice(-4);}