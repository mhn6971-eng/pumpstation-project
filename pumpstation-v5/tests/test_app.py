import sys, io, json
from pathlib import Path
import pytest
PROGRAM=Path(__file__).resolve().parents[1]/'program'
sys.path.insert(0,str(PROGRAM))
from app import create_app
from ps import security

@pytest.fixture()
def client(tmp_path):
    app=create_app(data_dir=tmp_path/'data', master_password='test-master-123', testing=True)
    app.config['TESTING']=True
    c=app.test_client()
    r=c.post('/api/login',json={'group':'A','pin':'1111'}); assert r.status_code==200
    return c,app,tmp_path/'data'

def login_admin(c):
    c.post('/api/logout'); r=c.post('/api/login',json={'group':'admin','pin':'9999'}); assert r.status_code==200

def test_dashboard(client):
    c,app,data=client
    d=c.get('/api/dashboard').get_json(); assert len(d['motors'])==8; assert len(d['intervals'])==6; assert d['shift']['key']=='A'

def test_process_and_alert(client):
    c,app,data=client
    login_admin(c)
    c.put('/api/admin/setpoints/process%3APIT-001',json={'warn_max':10,'crit_max':12,'phys_max':100})
    c.post('/api/logout'); c.post('/api/login',json={'group':'A','pin':'1111'})
    assert c.post('/api/process',json={'param':'PIT-001','value':11,'interval':0}).status_code==200
    assert c.post('/api/process',json={'param':'PIT-001','value':101,'interval':0}).status_code==400
    d=c.get('/api/dashboard').get_json(); assert any(a['tag']=='PIT-001' for a in d['alerts'])

def test_motor_service_resets(client):
    c,app,data=client
    assert c.post('/api/motors/1/values',json={'values':{'T1':60,'I1':100},'interval':0}).status_code==200
    assert c.post('/api/motors/1/state',json={'state':'on'}).status_code==200
    r=c.post('/api/motors/1/service',json={'workers':'تست','hmi_hours':100,'brush':{'U1':1},'confirm_lower':True})
    assert r.status_code==200
    d=c.get('/api/motors/1').get_json(); assert d['motor']['last_service_hours']==100; assert d['motor']['state']=='off'

def test_pdf_and_backup_restore(client):
    c,app,data=client
    c.post('/api/process',json={'param':'FIT-001','value':100,'interval':0})
    r=c.post('/api/reports/daily',json={}); assert r.status_code==200
    pdf=c.get(r.get_json()['url']); assert pdf.status_code==200 and pdf.data[:4]==b'%PDF'
    login_admin(c)
    b=c.post('/api/admin/backup'); assert b.status_code==200
    name=b.get_json()['name']
    enc=(data/'backups'/name).read_bytes(); assert enc.startswith(b'PSV5')
    assert c.post('/api/admin/restore',json={'filename':name,'confirm':True}).status_code==200

def test_registry_soft_delete(client):
    c,app,data=client
    login_admin(c)
    r=c.post('/api/equipment',json={'tag':'TEST-01','category_id':1,'name':'تست'}); eid=r.get_json()['id']
    assert c.delete(f'/api/equipment/{eid}').status_code==200
    rows=c.get('/api/equipment').get_json(); assert not any(x['id']==eid for x in rows)
    rows=c.get('/api/equipment?include_deleted=1').get_json(); assert any(x['id']==eid for x in rows)

def test_encrypted_at_rest(client):
    c,app,data=client
    blob=(data/'pumpstation.db.enc').read_bytes(); assert blob.startswith(b'PSV5')
    assert b'SQLite format' not in blob[:100]
